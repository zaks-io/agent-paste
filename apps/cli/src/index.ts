#!/usr/bin/env node
import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentPasteAuth,
  ApiClient,
  createIdempotencyKey,
  type EphemeralProvisionOptions,
  type PublishFile,
  runPublish as runSharedPublish,
} from "@agent-paste/api-client";
import type { EphemeralProvisionResponse } from "@agent-paste/contracts";
import { ArtifactId, RenderMode } from "@agent-paste/contracts";
import { type Credential, deleteCredential, isCredentialExpired, loadCredential } from "./credentials.js";
import {
  contentTypeForLocalPath,
  inferPublishOptions,
  sha256HexForFile,
  validateFilesAgainstUsagePolicy,
  walkLocalPath,
} from "./local.js";
import { login } from "./login.js";
import { apiClientTransport } from "./publish-transport.js";
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
import { commandInvocation, detectChannel, runUpdateCheck, signedOutHint } from "./update-check.js";
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
    return output({ authenticated: false }, parsed.global, signedOutHint(detectChannel()));
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

// POSIX single-quote escaping for a path embedded in a copy-pasteable shell
// command. Bare when it's already shell-safe; otherwise wrap in single quotes
// and escape any embedded single quote as '\''.
export function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function publish(parsed: Parsed, client: ApiClient) {
  const mode = outputModeFor(parsed.global);
  const result = await runPublish(parsed, client, mode);
  // Channel-correct command the agent reruns to revise this Artifact in place,
  // so it learns the revise verb at the moment it holds the id. Shell-quote the
  // path so spaces or special chars don't produce a broken revise command.
  const inputPath = requiredArg(parsed, 0, "path");
  const updateCommand = commandInvocation(
    detectChannel(),
    `publish ${shellQuote(inputPath)} --artifact-id ${result.artifact_id}`,
  );
  return output(result, parsed.global, formatPublishResult(mode, result, updateCommand));
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

  const publishFiles: PublishFile[] = files.map((file) => {
    const digest = digestByPath.get(file.path);
    if (!digest) {
      throw new Error(`Missing digest for ${file.path}`);
    }
    return {
      path: file.path,
      sizeBytes: digest.sizeBytes,
      sha256: digest.sha256,
      contentType: contentTypeForLocalPath(file.path),
      read: () => fs.readFile(file.absolutePath),
    };
  });

  const artifactIdFlag = stringFlag(parsed, "artifact-id");
  const artifactId = artifactIdFlag ? ArtifactId.parse(artifactIdFlag) : undefined;
  const progress = createProgress(mode);
  const outcome = await runSharedPublish(apiClientTransport(client), {
    files: publishFiles,
    title: inferred.title,
    entrypoint: inferred.entrypoint,
    ...(explicitRenderMode ? { renderMode: explicitRenderMode } : {}),
    ...(artifactId ? { artifactId } : {}),
    share: booleanFlag(parsed, "share", false),
    idempotencyKey: createIdempotencyKey("cli_publish"),
    onUploadProgress: ({ uploadedFiles, totalToUpload, uploadedBytes }) =>
      progress.update({ done: uploadedFiles, total: totalToUpload, bytes: uploadedBytes }),
  });
  progress.done();

  return {
    ...outcome.result,
    upload_stats: {
      total_files: outcome.uploadStats.totalFiles,
      total_bytes: outcome.uploadStats.totalBytes,
      uploaded_files: outcome.uploadStats.uploadedFiles,
      uploaded_bytes: outcome.uploadStats.uploadedBytes,
      reused_files: outcome.uploadStats.reusedFiles,
      reused_bytes: outcome.uploadStats.reusedBytes,
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

// Human-readable publish result. The handoff leads with the live viewer URL,
// then shows the one command to revise this Artifact in place so the agent
// edits via add-revision (stable link, live-updates the open page) instead of
// republishing a new Artifact. Snapshot URLs stay on the JSON surface.
function formatPublishResult(mode: OutputMode, result: PublishResultShape, updateCommand: string) {
  const label = (text: string) => paint(mode, "dim", text);
  const viewerUrl = result.access_link_url ?? result.artifact_url;
  return [
    `${paint(mode, "green", "✓")} Published ${paint(mode, "bold", `"${result.title}"`)}`,
    "",
    `  ${label("View")}      ${hyperlink(mode, viewerUrl)}`,
    `  ${label("Expires")}   ${formatExpiry(result.expires_at)}`,
    ...(result.upload_stats ? [uploadStatsLine(mode, result.upload_stats)] : []),
    "",
    `  ${label("Update")}    ${updateCommand}`,
    `            ${label("(revises this Artifact; same link live-updates the open page)")}`,
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
      ? ["", `  ${label("View")}      ${hyperlink(mode, viewerUrl)} ${paint(mode, "dim", "(works after claiming)")}`]
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

Publish:
  --artifact-id Revise an EXISTING Artifact: publishes a new Revision under it
                instead of creating a new Artifact. The viewer link is stable and
                live-updates pages already open — this is how you change published
                work. Omit it to create a new Artifact on a new link. Re-publishing
                an edit without --artifact-id strands the link the user already has.
  --title       Set the Artifact title.
  --entrypoint  Override the entrypoint file within <path>.
  --render-mode text | markdown | html (otherwise inferred from the entrypoint).
  --share       Explicitly create a public/shareable Share Link for publish.
  --ephemeral   Accountless 24h publish with a one-time claim link (no login).

Output:
  --json        Machine-readable JSON on stdout (stable, carries schema_version).
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
