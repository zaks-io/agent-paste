#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { type AgentPasteAuth, AgentPasteError, ApiClient, createIdempotencyKey } from "@agent-paste/api-client";
import { CreateUploadSessionRequest, WorkspaceId } from "@agent-paste/contracts";
import { deleteCredential, loadCredential } from "./credentials.js";
import {
  contentTypeForLocalPath,
  expiresAtFromTtl,
  inferPublishOptions,
  parseTtlSeconds,
  validateFilesAgainstUsagePolicy,
  walkLocalPath,
} from "./local.js";
import { login } from "./login.js";

type GlobalFlags = {
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
      return publish(parsed, client);
    case "admin workspace create":
      return output(
        await client.admin.workspaces.create(
          withOptional({ email: requiredArg(parsed, 0, "email") }, "name", stringFlag(parsed, "name")),
          createIdempotencyKey("cli_admin_workspace_create"),
        ),
        parsed.global,
      );
    case "admin workspace list":
      return output(await client.admin.workspaces.list(), parsed.global);
    case "admin key create": {
      const workspaceId = WorkspaceId.parse(requiredArg(parsed, 0, "workspace id"));
      return output(
        await client.admin.apiKeys.create(
          workspaceId,
          { name: stringFlag(parsed, "name") ?? "agent-paste CLI" },
          createIdempotencyKey("cli_admin_key_create"),
        ),
        parsed.global,
      );
    }
    case "admin key revoke":
      requireYes(parsed, `Refusing to revoke ${requiredArg(parsed, 0, "api key id")} without --yes.`);
      return output(
        await client.admin.apiKeys.revoke(
          requiredArg(parsed, 0, "api key id"),
          createIdempotencyKey("cli_admin_key_revoke"),
        ),
        parsed.global,
      );
    case "admin artifact list":
    case "list":
      return output(await client.admin.artifacts.list(), parsed.global);
    case "admin artifact get":
    case "get":
      return output(await client.admin.artifacts.get(requiredArg(parsed, 0, "artifact id")), parsed.global);
    case "admin artifact delete":
    case "delete":
      requireYes(parsed, `Refusing to delete ${requiredArg(parsed, 0, "artifact id")} without --yes.`);
      return output(
        await client.admin.artifacts.delete(
          requiredArg(parsed, 0, "artifact id"),
          createIdempotencyKey("cli_admin_artifact_delete"),
        ),
        parsed.global,
      );
    case "admin cleanup run":
      if (!booleanFlag(parsed, "dry-run", false)) {
        requireYes(parsed, "Refusing to run mutating cleanup without --yes.");
      }
      return output(
        await client.admin.cleanup.run(
          { dry_run: booleanFlag(parsed, "dry-run", false) },
          createIdempotencyKey("cli_admin_cleanup_run"),
        ),
        parsed.global,
      );
    case "admin events list":
      return output(await client.admin.operationEvents.list(), parsed.global);
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
  if (envKey && stored) {
    process.stderr.write("agent-paste: using AGENT_PASTE_API_KEY (overrides the stored login credential).\n");
  }
  if (envKey) {
    return new ApiClient();
  }
  if (stored) {
    const auth: AgentPasteAuth = { type: "api_key", apiKey: stored.api_key };
    return new ApiClient({ auth });
  }
  return new ApiClient();
}

async function logout(global: GlobalFlags) {
  const stored = await loadCredential();
  if (!stored) {
    return output({ status: "no_credential" }, global, "Not signed in. Nothing to remove.");
  }
  await deleteCredential();
  return output(
    { status: "logged_out", public_id: stored.public_id },
    global,
    `Removed stored API key ${stored.public_id}.`,
  );
}

async function publish(parsed: Parsed, client: ApiClient) {
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
    ttl_seconds: ttlSecondsForPublish(parsed, policy),
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
  const result = await client.revisions.publish(finalized.artifact_id, finalized.revision_id, idempotencyKey);
  return output(result, parsed.global, formatPublishResult(result));
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
  const second = positionals[1] ?? "";
  const third = positionals[2] ?? "";
  if (first === "admin" && ["workspace", "key", "artifact", "cleanup", "events"].includes(second)) {
    return [first, second, third].filter(Boolean);
  }
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

function requireYes(parsed: Parsed, message: string) {
  if (!booleanFlag(parsed, "yes", false)) {
    throw new Error(message);
  }
}

function output(value: unknown, global: GlobalFlags, human = JSON.stringify(value, null, 2)) {
  if (global.json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else if (!global.quiet) {
    process.stdout.write(`${human}\n`);
  }
}

function formatPublishResult(result: {
  artifact_id: string;
  revision_id: string;
  title: string;
  view_url: string;
  agent_view_url: string;
  expires_at: string;
}) {
  return [
    `Published artifact ${result.artifact_id} revision ${result.revision_id}`,
    "",
    `  Title:      ${result.title}`,
    `  View:       ${result.view_url}`,
    `  Agent View: ${result.agent_view_url}`,
    `  Expires:    ${result.expires_at}`,
  ].join("\n");
}

function printHelp() {
  process.stdout.write(`agent-paste

Usage:
  agent-paste login
  agent-paste logout
  agent-paste whoami [--json]
  agent-paste publish <path> [--artifact-id <id>] [--title <text>] [--entrypoint <path>] [--render-mode <mode>] [--ttl 7d] [--json]
  agent-paste admin workspace create <email> [--name <text>]
  agent-paste admin key create <workspace-id> [--name <text>]
  agent-paste admin key revoke <api-key-id> --yes
  agent-paste admin artifact list|get ...
  agent-paste admin artifact delete <artifact-id> --yes
  agent-paste admin cleanup run [--dry-run|--yes]
`);
}

function ttlSecondsForPublish(parsed: Parsed, policy: Awaited<ReturnType<ApiClient["usagePolicy"]>>) {
  const ttl = stringFlag(parsed, "ttl");
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

function withOptional<T extends Record<string, unknown>, K extends string, V>(
  object: T,
  key: K,
  value: V | undefined,
): T & Partial<Record<K, V>> {
  return (value === undefined ? object : { ...object, [key]: value }) as T & Partial<Record<K, V>>;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const asError = error instanceof Error ? error : new Error(String(error));
    const code = error instanceof AgentPasteError ? error.code : "cli_error";
    process.stderr.write(`agent-paste: ${code}: ${asError.message}\n`);
    process.exitCode = 1;
  });
}
