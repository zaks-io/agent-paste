#!/usr/bin/env node
import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentPasteAuth,
  ApiClient,
  createIdempotencyKey,
  type EphemeralProvisionOptions,
} from "@agent-paste/api-client";
import type { EphemeralProvisionResponse } from "@agent-paste/contracts";
import { CreateUploadSessionRequest, RenderMode } from "@agent-paste/contracts";
import { type Credential, deleteCredential, isCredentialExpired, loadCredential } from "./credentials.js";
import {
  contentTypeForLocalPath,
  inferPublishOptions,
  sha256HexForFile,
  validateFilesAgainstUsagePolicy,
  walkLocalPath,
} from "./local.js";
import { login } from "./login.js";
import {
  createProgress,
  exitCodeFor,
  formatBytes,
  formatError,
  hyperlink,
  type OutputMode,
  paint,
  resolveMode,
} from "./render.js";
import { runUpdateCheck } from "./update-check.js";
import { runUpgrade } from "./upgrade.js";
import { CLI_VERSION } from "./version.js";

export const SCHEMA_VERSION = "1";

export type GlobalFlags = {
  json: boolean;
  quiet: boolean;
  color?: boolean | undefined;
};

type Parsed = {
  command: string[];
  positionals: string[];
  flags: Map<string, string | boolean>;
  global: GlobalFlags;
};

export async function main(argv = process.argv.slice(2), client?: ApiClient) {
  const parsed = parseArgs(argv);
  const command = parsed.command.join(" ");
  // `--version`/`-v` parse as a flag and a positional respectively, not as a
  // subcommand, so detect them before the command switch (where a `--version`
  // flag would otherwise fall through to the empty-command help case). Gate the
  // bare `--version` flag on there being no real subcommand, so `upgrade
  // --version` is not hijacked into printing the version.
  if (command === "version" || command === "-v" || (command === "" && booleanFlag(parsed, "version", false))) {
    return output({ version: CLI_VERSION }, parsed.global, CLI_VERSION);
  }
  switch (command) {
    case "":
    case "help":
    case "--help":
      return printHelp();
    case "login":
      await login();
      return;
    case "logout":
      return logout(parsed.global);
    case "upgrade":
      return runUpgrade(parsed.positionals[0] ? { version: parsed.positionals[0] } : {});
  }

  if (!client && command === "whoami" && !(await hasResolvableAuth())) {
    return output(
      { authenticated: false },
      parsed.global,
      "Not signed in. Run `agent-paste login` or use `agent-paste publish --ephemeral` for an accountless handoff.",
    );
  }

  const apiClient = client ?? (await resolveClient());
  const result = await dispatch(command, parsed, apiClient);
  await runUpdateCheck(parsed.global);
  return result;
}

async function dispatch(command: string, parsed: Parsed, client: ApiClient) {
  switch (command) {
    case "whoami":
      return output(await client.whoami(), parsed.global);
    case "publish":
      if (booleanFlag(parsed, "ephemeral", false)) {
        return publishEphemeral(parsed);
      }
      return publish(parsed, client);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// `whoami` answering "you're nobody" is a valid answer, not a failure. When no
// usable credential is present we report it and exit 0 rather than forcing a
// 401 round-trip — the CLI also serves anonymous (`--ephemeral`) flows.
async function hasResolvableAuth(): Promise<boolean> {
  if (process.env.AGENT_PASTE_API_KEY) {
    return true;
  }
  const stored = await loadCredential();
  return Boolean(stored && !isCredentialExpired(stored));
}

// The legacy environment credential wins for CI/headless compatibility;
// otherwise the credential stored by `agent-paste login` is used. When both are
// present we note which one wins so surprising precedence is visible.
async function resolveClient(): Promise<ApiClient> {
  const envKey = process.env.AGENT_PASTE_API_KEY;
  const stored = await loadCredential();
  const usableStored = stored && isCredentialExpired(stored) ? null : stored;
  if (stored && !usableStored) {
    await deleteCredential();
    process.stderr.write(`agent-paste: removed expired stored login credential ${stored.public_id}.\n`);
  }
  if (envKey && usableStored) {
    process.stderr.write("agent-paste: using the environment credential (overrides the stored login credential).\n");
  }
  if (envKey) {
    return new ApiClient();
  }
  if (usableStored) {
    const auth: AgentPasteAuth = { type: "api_key", apiKey: usableStored.api_key };
    return new ApiClient({ auth });
  }
  return new ApiClient();
}

export type LogoutDeps = {
  load?: () => Promise<Credential | null>;
  delete?: () => Promise<void>;
  client?: ApiClient;
  clientForCredential?: (credential: Credential) => ApiClient;
  warn?: (message: string) => void;
  now?: Date;
};

export async function logout(global: GlobalFlags, deps: LogoutDeps = {}) {
  const load = deps.load ?? loadCredential;
  const remove = deps.delete ?? deleteCredential;
  const warn = deps.warn ?? ((message: string) => process.stderr.write(message));
  const stored = await load();
  if (!stored) {
    return output({ status: "no_credential" }, global, "Not signed in. Nothing to remove.");
  }
  if (isCredentialExpired(stored, deps.now)) {
    await remove();
    return output(
      { status: "logged_out", public_id: stored.public_id, remote_revoked: false, reason: "expired" },
      global,
      `Removed expired stored credential ${stored.public_id}.`,
    );
  }

  const client =
    deps.client ??
    deps.clientForCredential?.(stored) ??
    new ApiClient({ auth: { type: "api_key", apiKey: stored.api_key } });
  let remoteRevoked = true;
  try {
    await client.apiKeys.revokeCurrent();
  } catch (error) {
    remoteRevoked = false;
    const message = error instanceof Error ? error.message : String(error);
    warn(`agent-paste: remote revoke failed for stored credential ${stored.public_id}: ${message}\n`);
  }
  await remove();
  return output(
    { status: "logged_out", public_id: stored.public_id, remote_revoked: remoteRevoked },
    global,
    remoteRevoked
      ? `Revoked and removed stored credential ${stored.public_id}.`
      : `Removed stored credential ${stored.public_id}. Remote revoke failed; it may remain active.`,
  );
}

export type EphemeralPublishDeps = {
  provision?: (options?: EphemeralProvisionOptions) => Promise<EphemeralProvisionResponse>;
  createPublishClient?: (apiKeySecret: string, bases: { apiBaseUrl: string; uploadBaseUrl: string }) => ApiClient;
};

export async function publishEphemeral(parsed: Parsed, deps: EphemeralPublishDeps = {}) {
  await noteEphemeralCredentialPrecedence();
  const provisionClient = unauthenticatedClient();
  const provisioned = await (deps.provision ?? ((options) => provisionClient.ephemeral.provision(options)))();
  const publishClient =
    deps.createPublishClient?.(provisioned.api_key_secret, {
      apiBaseUrl: provisionClient.apiBaseUrl,
      uploadBaseUrl: provisionClient.uploadBaseUrl,
    }) ??
    new ApiClient({
      apiBaseUrl: provisionClient.apiBaseUrl,
      uploadBaseUrl: provisionClient.uploadBaseUrl,
      auth: { type: "api_key", apiKey: provisioned.api_key_secret },
    });
  const mode = outputModeFor(parsed.global);
  const result = await runPublish(parsed, publishClient, mode);
  const claimUrl = ephemeralClaimUrl(provisioned.claim_token);
  const payload = {
    ...result,
    claim_token: provisioned.claim_token,
    claim_url: claimUrl,
    workspace_id: provisioned.workspace_id,
    api_key_id: provisioned.api_key_id,
    claim_token_id: provisioned.claim_token_id,
  };
  return output(payload, parsed.global, formatEphemeralPublishResult(mode, result, claimUrl));
}

async function noteEphemeralCredentialPrecedence() {
  if (process.env.AGENT_PASTE_API_KEY) {
    process.stderr.write("agent-paste: --ephemeral ignores the environment credential.\n");
  }
  const stored = await loadCredential();
  if (stored && !isCredentialExpired(stored)) {
    process.stderr.write("agent-paste: --ephemeral ignores the stored login credential.\n");
  }
}

function unauthenticatedClient() {
  return new ApiClient();
}

async function publish(parsed: Parsed, client: ApiClient) {
  const mode = outputModeFor(parsed.global);
  const result = await runPublish(parsed, client, mode);
  return output(result, parsed.global, formatPublishResult(mode, result));
}

async function runPublish(parsed: Parsed, client: ApiClient, mode: OutputMode) {
  const inputPath = requiredArg(parsed, 0, "path");
  const files = await walkLocalPath(inputPath);
  const policy = await client.usagePolicy();
  validateFilesAgainstUsagePolicy(files, policy);

  const overrides: Parameters<typeof inferPublishOptions>[2] = {};
  const title = stringFlag(parsed, "title");
  const entrypoint = stringFlag(parsed, "entrypoint");
  // An explicit --render-mode is validated against the contract enum and
  // transmitted so the server stores it verbatim. When the flag is absent the
  // field is omitted and the server infers from the entrypoint extension
  // (same shared map as the local inference below).
  const renderMode = stringFlag(parsed, "render-mode");
  const explicitRenderMode = renderMode === undefined ? undefined : RenderMode.parse(renderMode);
  if (title) overrides.title = title;
  if (entrypoint) overrides.entrypoint = entrypoint;
  if (explicitRenderMode) overrides.renderMode = explicitRenderMode;
  const inferred = inferPublishOptions(inputPath, files, overrides);

  const digestByPath = new Map(
    await Promise.all(files.map(async (file) => [file.path, await sha256HexForFile(file.absolutePath)] as const)),
  );

  const idempotencyKey = createIdempotencyKey("cli_publish");
  const createSessionRequest = CreateUploadSessionRequest.parse({
    ...(stringFlag(parsed, "artifact-id") ? { artifact_id: stringFlag(parsed, "artifact-id") } : {}),
    title: inferred.title,
    entrypoint: inferred.entrypoint,
    ...(explicitRenderMode ? { render_mode: explicitRenderMode } : {}),
    files: files.map((file) => {
      const digest = digestByPath.get(file.path);
      if (!digest) {
        throw new Error(`Missing digest for ${file.path}`);
      }
      return {
        path: file.path,
        size_bytes: digest.sizeBytes,
        sha256: digest.sha256,
      };
    }),
  });
  const session = await client.uploadSessions.create(createSessionRequest, idempotencyKey);

  let uploadedFiles = 0;
  let uploadedBytes = 0;
  let reusedFiles = 0;
  let reusedBytes = 0;
  // Per-file progress, granularity-agnostic: the serial loop ticks 1/N, 2/N…;
  // a future parallel upload would call update() on each completion unchanged.
  const toUpload = session.files.filter((target) => target.status !== "reused").length;
  const progress = createProgress(mode);
  for (const target of session.files) {
    const local = files.find((file) => file.path === target.path);
    if (!local) {
      throw new Error(`Upload session returned unknown file ${target.path}`);
    }
    if (target.status === "reused") {
      reusedFiles += 1;
      reusedBytes += local.sizeBytes;
      continue;
    }
    await client.putFile(target.put_url, await fs.readFile(local.absolutePath), {
      "content-type": contentTypeForLocalPath(local.path),
    });
    uploadedFiles += 1;
    uploadedBytes += local.sizeBytes;
    progress.update({ done: uploadedFiles, total: toUpload, bytes: uploadedBytes });
  }
  progress.done();

  const finalized = await client.uploadSessions.finalize(session.upload_session_id, idempotencyKey);
  const share = booleanFlag(parsed, "share", false);
  const published = share
    ? await client.revisions.publish(finalized.artifact_id, finalized.revision_id, idempotencyKey, { share: true })
    : await client.revisions.publish(finalized.artifact_id, finalized.revision_id, idempotencyKey);
  return {
    ...published,
    upload_stats: {
      total_files: session.files.length,
      total_bytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      uploaded_files: uploadedFiles,
      uploaded_bytes: uploadedBytes,
      reused_files: reusedFiles,
      reused_bytes: reusedBytes,
    },
  };
}

export function parseArgs(argv: string[]): Parsed {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
    if (arg.startsWith("--")) {
      const raw = arg.slice(2);
      if (raw.startsWith("no-")) {
        flags.set(raw.slice(3), false);
        continue;
      }
      const [name, inlineValue] = raw.split("=", 2);
      if (!name) {
        continue;
      }
      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
      } else if (takesValue(name)) {
        index += 1;
        const value = argv[index];
        if (!value) {
          throw new Error(`Missing value for --${name}`);
        }
        flags.set(name, value);
      } else {
        flags.set(name, true);
      }
    } else {
      positionals.push(arg);
    }
  }
  const command = commandParts(positionals);
  return {
    command,
    positionals: positionals.slice(command.length),
    flags,
    global: {
      json: booleanFlag({ flags }, "json", false),
      quiet: booleanFlag({ flags }, "quiet", false),
      color: optionalBooleanFlag({ flags }, "color"),
    },
  };
}

function commandParts(positionals: string[]) {
  const first = positionals[0] ?? "";
  return first ? [first] : [];
}

function takesValue(name: string) {
  return new Set(["artifact-id", "title", "entrypoint", "render-mode", "name"]).has(name);
}

function requiredArg(parsed: Parsed, index: number, label: string) {
  const value = parsed.positionals[index];
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function stringFlag(parsed: Parsed, name: string) {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function booleanFlag(parsed: Pick<Parsed, "flags">, name: string, fallback: boolean) {
  const value = parsed.flags.get(name);
  return typeof value === "boolean" ? value : fallback;
}

// Tri-state: --color forces rich, --no-color forces plain, absent (undefined)
// defers to TTY/NO_COLOR/CI detection in resolveMode.
function optionalBooleanFlag(parsed: Pick<Parsed, "flags">, name: string): boolean | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "boolean" ? value : undefined;
}

function outputModeFor(global: GlobalFlags): OutputMode {
  return resolveMode({
    json: global.json,
    color: global.color,
    env: {
      isTTY: Boolean(process.stdout.isTTY),
      NO_COLOR: process.env.NO_COLOR,
      CI: process.env.CI,
      TERM: process.env.TERM,
    },
  });
}

async function output(value: unknown, global: GlobalFlags, human = JSON.stringify(value, null, 2)) {
  if (global.json) {
    const payload =
      value && typeof value === "object" && !Array.isArray(value)
        ? { schema_version: SCHEMA_VERSION, ...(value as Record<string, unknown>) }
        : { schema_version: SCHEMA_VERSION, value };
    await writeStdout(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (!global.quiet) {
    await writeStdout(`${human}\n`);
  }
}

function writeStdout(value: string) {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(value, (error?: unknown) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

type PublishResultShape = {
  artifact_id: string;
  revision_id: string;
  title: string;
  artifact_url: string;
  access_link_url?: string | undefined;
  revision_content_url: string;
  agent_view_url: string;
  expires_at: string;
  upload_stats?: {
    total_files: number;
    total_bytes: number;
    uploaded_files: number;
    uploaded_bytes: number;
    reused_files: number;
    reused_bytes: number;
  };
};

// Render expires_at as a plain calendar date when it parses as an ISO instant;
// otherwise pass the raw value through unchanged. Never fabricate a date.
function formatExpiry(expiresAt: string) {
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime()) ? expiresAt : date.toISOString().slice(0, 10);
}

function uploadStatsLine(mode: OutputMode, stats: NonNullable<PublishResultShape["upload_stats"]>) {
  const uploaded = paint(mode, "green", `${stats.uploaded_files}/${stats.total_files} uploaded`);
  return `  ${paint(mode, "dim", "Upload")}    ${uploaded}, ${stats.reused_files} reused · ${formatBytes(stats.uploaded_bytes)} sent, ${formatBytes(stats.reused_bytes)} cached`;
}

// Human-readable publish result. Keep the default handoff focused on the live
// viewer URL; JSON is the explicit machine/debug surface for IDs and snapshots.
function formatPublishResult(mode: OutputMode, result: PublishResultShape) {
  const label = (text: string) => paint(mode, "dim", text);
  const viewerUrl = result.access_link_url ?? result.artifact_url;
  return [
    `${paint(mode, "green", "✓")} Published ${paint(mode, "bold", `"${result.title}"`)}`,
    "",
    `  ${label("View")}      ${hyperlink(mode, viewerUrl)}`,
    `  ${label("Expires")}   ${formatExpiry(result.expires_at)}`,
    ...(result.upload_stats ? [uploadStatsLine(mode, result.upload_stats)] : []),
    ...(viewerUrl ? ["", paint(mode, "cyan", `  → open ${viewerUrl}`)] : []),
  ].join("\n");
}

export function ephemeralClaimUrl(claimToken: string) {
  const base = (process.env.AGENT_PASTE_WEB_URL ?? "https://app.agent-paste.sh").replace(/\/+$/, "");
  return `${base}/claim#${claimToken}`;
}

function formatEphemeralPublishResult(mode: OutputMode, result: PublishResultShape, claimUrl: string) {
  assertClaimTokenNotInPublicUrls(result, claimUrl);
  const label = (text: string) => paint(mode, "dim", text);
  const viewerUrl = result.access_link_url ?? result.artifact_url;
  return [
    `${paint(mode, "green", "✓")} Published ${paint(mode, "bold", `"${result.title}"`)}`,
    "",
    paint(mode, "dim", "Open this to view, keep, and unlock your artifact:"),
    `  ${label("Claim")}    ${hyperlink(mode, claimUrl)}`,
    `  ${label("Expires")}   ${formatExpiry(result.expires_at)}`,
    ...(result.upload_stats ? [uploadStatsLine(mode, result.upload_stats)] : []),
    "",
    paint(mode, "dim", "The token lives in the URL hash only (never the query string)."),
    ...(viewerUrl
      ? [
          "",
          `  ${label("View")}      ${hyperlink(mode, viewerUrl)} ${paint(mode, "dim", "(works after claiming)")}`,
        ]
      : []),
    "",
    paint(mode, "cyan", `  → open ${claimUrl}`),
  ].join("\n");
}

function assertClaimTokenNotInPublicUrls(result: PublishResultShape, claimUrl: string) {
  const claimToken = claimUrl.split("#")[1] ?? "";
  if (!claimToken || !claimUrl.includes("#")) {
    throw new Error("Claim URL must carry the token in the URL hash");
  }
  if (claimUrl.includes("?") && claimUrl.includes(claimToken)) {
    throw new Error("Claim Token must not appear in the URL query string");
  }
  if (
    result.artifact_url.includes(claimToken) ||
    result.access_link_url?.includes(claimToken) ||
    result.revision_content_url.includes(claimToken) ||
    result.agent_view_url.includes(claimToken)
  ) {
    throw new Error("Claim Token must not appear in public Access Link Signed URLs");
  }
}

function printHelp() {
  return writeStdout(`agent-paste

Usage:
  agent-paste login
  agent-paste logout
  agent-paste whoami [--json]
  agent-paste publish <path> [--artifact-id <id>] [--title <text>] [--entrypoint <path>] [--render-mode <mode>] [--share] [--ephemeral] [--json]
  agent-paste version [--json]
  agent-paste upgrade [<tag>]

Output:
  --json        Machine-readable JSON on stdout (stable, carries schema_version).
  --share       Explicitly create a public/shareable Share Link for publish.
  --quiet       Suppress the human summary; errors and exit code still apply.
  --color       Force colour/rich output; --no-color forces plain.
                Default: rich on a TTY, plain when piped or NO_COLOR/CI is set.
`);
}

export function isMainEntrypoint(metaUrl: string, argv1: string | undefined, platform = process.platform) {
  if (!argv1) {
    return false;
  }
  const modulePath = executablePath(fileURLToPath(metaUrl));
  const entryPath = executablePath(argv1);
  if (platform === "win32") {
    return modulePath.toLowerCase() === entryPath.toLowerCase();
  }
  return modulePath === entryPath;
}

function executablePath(value: string) {
  const resolved = path.resolve(value);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

if (isMainEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    // Errors go to stderr so stdout stays a clean channel (pure JSON under
    // --json). JSON error envelope only when --json is set; otherwise the
    // human-facing renderer, rich when stderr is a TTY.
    const mode = process.argv.includes("--json") ? "json" : process.stderr.isTTY ? "rich" : "plain";
    process.stderr.write(formatError(mode, error));
    process.exitCode = exitCodeFor(error);
  });
}
