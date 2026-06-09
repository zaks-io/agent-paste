#!/usr/bin/env node
import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentPasteAuth,
  AgentPasteError,
  ApiClient,
  createIdempotencyKey,
  type EphemeralProvisionOptions,
} from "@agent-paste/api-client";
import type { EphemeralProvisionResponse } from "@agent-paste/contracts";
import { CreateUploadSessionRequest } from "@agent-paste/contracts";
import { type Credential, deleteCredential, isCredentialExpired, loadCredential } from "./credentials.js";
import {
  contentTypeForLocalPath,
  inferPublishOptions,
  validateFilesAgainstUsagePolicy,
  walkLocalPath,
} from "./local.js";
import { login } from "./login.js";
import { runUpdateCheck } from "./update-check.js";
import { runUpgrade } from "./upgrade.js";
import { CLI_VERSION } from "./version.js";

export type GlobalFlags = {
  json: boolean;
  quiet: boolean;
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
      "Not signed in. Run `agent-paste login` or set AGENT_PASTE_API_KEY.",
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

// AGENT_PASTE_API_KEY wins for CI/headless use; otherwise the key stored by
// `agent-paste login` is used. When both are present we note which one wins so
// surprising precedence is visible (ADR 0060).
async function resolveClient(): Promise<ApiClient> {
  const envKey = process.env.AGENT_PASTE_API_KEY;
  const stored = await loadCredential();
  const usableStored = stored && isCredentialExpired(stored) ? null : stored;
  if (stored && !usableStored) {
    await deleteCredential();
    process.stderr.write(`agent-paste: removed expired stored login credential ${stored.public_id}.\n`);
  }
  if (envKey && usableStored) {
    process.stderr.write("agent-paste: using AGENT_PASTE_API_KEY (overrides the stored login credential).\n");
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
      `Removed expired stored API key ${stored.public_id}.`,
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
    warn(`agent-paste: remote revoke failed for stored API key ${stored.public_id}: ${message}\n`);
  }
  await remove();
  return output(
    { status: "logged_out", public_id: stored.public_id, remote_revoked: remoteRevoked },
    global,
    remoteRevoked
      ? `Revoked and removed stored API key ${stored.public_id}.`
      : `Removed stored API key ${stored.public_id}. Remote revoke failed; the key may remain active.`,
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
  const result = await runPublish(parsed, publishClient);
  const claimUrl = ephemeralClaimUrl(provisioned.claim_token);
  const payload = {
    ...result,
    claim_token: provisioned.claim_token,
    claim_url: claimUrl,
    workspace_id: provisioned.workspace_id,
    api_key_id: provisioned.api_key_id,
    claim_token_id: provisioned.claim_token_id,
  };
  return output(payload, parsed.global, formatEphemeralPublishResult(result, claimUrl));
}

async function noteEphemeralCredentialPrecedence() {
  if (process.env.AGENT_PASTE_API_KEY) {
    process.stderr.write("agent-paste: --ephemeral ignores AGENT_PASTE_API_KEY.\n");
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
  const result = await runPublish(parsed, client);
  return output(result, parsed.global, formatPublishResult(result));
}

async function runPublish(parsed: Parsed, client: ApiClient) {
  const inputPath = requiredArg(parsed, 0, "path");
  const files = await walkLocalPath(inputPath);
  const policy = await client.usagePolicy();
  validateFilesAgainstUsagePolicy(files, policy);

  const overrides: Parameters<typeof inferPublishOptions>[2] = {};
  const title = stringFlag(parsed, "title");
  const entrypoint = stringFlag(parsed, "entrypoint");
  const renderMode = stringFlag(parsed, "render-mode") as
    | ReturnType<typeof inferPublishOptions>["renderMode"]
    | undefined;
  if (title) overrides.title = title;
  if (entrypoint) overrides.entrypoint = entrypoint;
  if (renderMode) overrides.renderMode = renderMode;
  const inferred = inferPublishOptions(inputPath, files, overrides);

  const idempotencyKey = createIdempotencyKey("cli_publish");
  const createSessionRequest = CreateUploadSessionRequest.parse({
    ...(stringFlag(parsed, "artifact-id") ? { artifact_id: stringFlag(parsed, "artifact-id") } : {}),
    title: inferred.title,
    entrypoint: inferred.entrypoint,
    files: files.map((file) => ({ path: file.path, size_bytes: file.sizeBytes })),
  });
  const session = await client.uploadSessions.create(createSessionRequest, idempotencyKey);

  for (const target of session.files) {
    const local = files.find((file) => file.path === target.path);
    if (!local) {
      throw new Error(`Upload session returned unknown file ${target.path}`);
    }
    await client.putFile(target.put_url, await fs.readFile(local.absolutePath), {
      "content-type": contentTypeForLocalPath(local.path),
    });
  }

  const finalized = await client.uploadSessions.finalize(session.upload_session_id, idempotencyKey);
  return client.revisions.publish(finalized.artifact_id, finalized.revision_id, idempotencyKey);
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
    global: { json: booleanFlag({ flags }, "json", false), quiet: booleanFlag({ flags }, "quiet", false) },
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

async function output(value: unknown, global: GlobalFlags, human = JSON.stringify(value, null, 2)) {
  if (global.json) {
    await writeStdout(`${JSON.stringify(value, null, 2)}\n`);
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
  revision_content_url: string;
  agent_view_url: string;
  expires_at: string;
};

// Render expires_at as a plain calendar date when it parses as an ISO instant;
// otherwise pass the raw value through unchanged. Never fabricate a date.
function formatExpiry(expiresAt: string) {
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime()) ? expiresAt : date.toISOString().slice(0, 10);
}

// Human-readable publish result. Title-led so a person sees what shipped first;
// the ids sit on a dim second line for reference. Artifact is the stable live
// app viewer; Revision is the exact content-origin URL retained for snapshots.
function formatPublishResult(result: PublishResultShape) {
  return [
    `✓ Published "${result.title}"`,
    `  ${result.artifact_id} · ${result.revision_id}`,
    "",
    `  Artifact  ${result.artifact_url}`,
    `  Revision  ${result.revision_content_url}`,
    `  Agent     ${result.agent_view_url}`,
    `  Expires   ${formatExpiry(result.expires_at)}`,
  ].join("\n");
}

export function ephemeralClaimUrl(claimToken: string) {
  const base = (process.env.AGENT_PASTE_WEB_URL ?? "https://app.agent-paste.sh").replace(/\/+$/, "");
  return `${base}/claim#${claimToken}`;
}

function formatEphemeralPublishResult(result: PublishResultShape, claimUrl: string) {
  assertClaimTokenNotInPublicUrls(result, claimUrl);
  return [
    formatPublishResult(result),
    "",
    "Open the claim link in a browser while signed in. The token lives in the URL hash only (never the query string).",
    `  Claim    ${claimUrl}`,
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
    result.revision_content_url.includes(claimToken) ||
    result.agent_view_url.includes(claimToken)
  ) {
    throw new Error("Claim Token must not appear in public share URLs");
  }
}

function printHelp() {
  return writeStdout(`agent-paste

Usage:
  agent-paste login
  agent-paste logout
  agent-paste whoami [--json]
  agent-paste publish <path> [--artifact-id <id>] [--title <text>] [--entrypoint <path>] [--render-mode <mode>] [--ephemeral] [--json]
  agent-paste version [--json]
  agent-paste upgrade [<tag>]
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
    const asError = error instanceof Error ? error : new Error(String(error));
    const code = error instanceof AgentPasteError ? error.code : "cli_error";
    process.stderr.write(`agent-paste: ${code}: ${asError.message}\n`);
    process.exitCode = 1;
  });
}
