#!/usr/bin/env node
import { promises as fs } from "node:fs";
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
  expiresAtFromTtl,
  inferPublishOptions,
  parseTtlSeconds,
  validateFilesAgainstUsagePolicy,
  walkLocalPath,
} from "./local.js";
import { login } from "./login.js";

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
  switch (command) {
    case "":
    case "help":
    case "--help":
      printHelp();
      return;
    case "login":
      await login();
      return;
    case "logout":
      return logout(parsed.global);
  }

  const apiClient = client ?? (await resolveClient());
  return dispatch(command, parsed, apiClient);
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
  const result = await runPublish(parsed, publishClient, { ephemeral: true });
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

const EPHEMERAL_MAX_TTL_SECONDS = 86_400;

async function runPublish(parsed: Parsed, client: ApiClient, options: { ephemeral?: boolean } = {}) {
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
    ttl_seconds: ttlSecondsForPublish(parsed, policy, options),
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
  return new Set(["artifact-id", "title", "entrypoint", "render-mode", "ttl", "name"]).has(name);
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

function output(value: unknown, global: GlobalFlags, human = JSON.stringify(value, null, 2)) {
  if (global.json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else if (!global.quiet) {
    process.stdout.write(`${human}\n`);
  }
}

type PublishResultShape = {
  artifact_id: string;
  revision_id: string;
  title: string;
  view_url: string;
  agent_view_url: string;
  expires_at: string;
};

function formatPublishResult(result: PublishResultShape) {
  return [
    `Published artifact ${result.artifact_id} revision ${result.revision_id}`,
    "",
    `  Title:      ${result.title}`,
    `  View:       ${result.view_url}`,
    `  Agent View: ${result.agent_view_url}`,
    `  Expires:    ${result.expires_at}`,
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
    `  Claim:      ${claimUrl}`,
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
  if (result.view_url.includes(claimToken) || result.agent_view_url.includes(claimToken)) {
    throw new Error("Claim Token must not appear in public share URLs");
  }
}

function printHelp() {
  process.stdout.write(`agent-paste

Usage:
  agent-paste login
  agent-paste logout
  agent-paste whoami [--json]
  agent-paste publish <path> [--artifact-id <id>] [--title <text>] [--entrypoint <path>] [--render-mode <mode>] [--ttl 7d] [--ephemeral] [--json]
`);
}

function ttlSecondsForPublish(
  parsed: Parsed,
  policy: Awaited<ReturnType<ApiClient["usagePolicy"]>>,
  options: { ephemeral?: boolean } = {},
) {
  const ttl = stringFlag(parsed, "ttl");
  if (options.ephemeral) {
    if (!ttl) {
      return EPHEMERAL_MAX_TTL_SECONDS;
    }
    const seconds = parseTtlSeconds(ttl);
    if (seconds > EPHEMERAL_MAX_TTL_SECONDS) {
      throw new Error(`TTL exceeds ephemeral maximum of ${EPHEMERAL_MAX_TTL_SECONDS} seconds (1d)`);
    }
    expiresAtFromTtl(ttl, new Date(), EPHEMERAL_MAX_TTL_SECONDS / 86_400);
    if (seconds < policy.min_ttl_seconds) {
      throw new Error(`TTL is below workspace minimum of ${policy.min_ttl_seconds} seconds`);
    }
    return seconds;
  }
  if (!ttl) {
    return policy.default_ttl_seconds;
  }
  const seconds = parseTtlSeconds(ttl);
  expiresAtFromTtl(ttl, new Date(), policy.max_ttl_seconds / 86_400);
  if (seconds < policy.min_ttl_seconds) {
    throw new Error(`TTL is below workspace minimum of ${policy.min_ttl_seconds} seconds`);
  }
  return seconds;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const asError = error instanceof Error ? error : new Error(String(error));
    const code = error instanceof AgentPasteError ? error.code : "cli_error";
    process.stderr.write(`agent-paste: ${code}: ${asError.message}\n`);
    process.exitCode = 1;
  });
}
