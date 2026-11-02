#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentPasteAuth,
  AgentPasteError,
  ApiClient,
  type EphemeralProvisionOptions,
} from "@agent-paste/api-client";
import type { EphemeralProvisionResponse } from "@agent-paste/contracts/ephemeral";
import { ArtifactReference, CLAIM_CODE_HEADER, ClaimCode, FilePath } from "@agent-paste/contracts/primitives";
import { mvpUsagePolicy } from "@agent-paste/contracts/workspace";
import {
  booleanFlag,
  type GlobalFlags,
  output,
  outputModeFor,
  type Parsed,
  parseArgs,
  requiredArg,
  stringFlag,
  writeStdout,
} from "./cli-args.js";
import { type Credential, deleteCredential, isCredentialExpired, loadCredential } from "./credentials.js";
import { deleteArtifact } from "./delete.js";
import { download } from "./download.js";
import { edit } from "./edit.js";
import { feedback } from "./feedback.js";
import { HELP_TEXT, PUBLISH_HELP_TEXT, PULL_HELP_TEXT } from "./help.js";
import { list } from "./list.js";
import { login } from "./login.js";
import { pin } from "./pin.js";
import { publish, runPreparedPublish } from "./publish.js";
import { ephemeralClaimUrl, formatEphemeralPublishResult } from "./publish-format.js";
import { digestPublish, preparePublish, validatePublishUsage } from "./publish-preflight.js";
import { pullDirectory } from "./pull-dir.js";
import { exitCodeFor, formatError } from "./render.js";
import { detectChannel, runUpdateCheck, signedOutHint } from "./update-check.js";
import { runUpgrade } from "./upgrade.js";
import { CLI_VERSION } from "./version.js";

export { type GlobalFlags, parseArgs, SCHEMA_VERSION, shellQuote } from "./cli-args.js";
export { readEdits } from "./edit.js";
// Re-exported for tests and downstream importers that reach for them via the CLI entrypoint.
export { ephemeralClaimUrl } from "./publish-format.js";

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
  // `<subcommand> --help` (e.g. `publish --help`) must print help, not fall
  // through to the subcommand and fail on a missing positional. A bare `--help`
  // parses as the command; a `--help` flag alongside any command lands here.
  if (command === "help") {
    return printHelp(parsed.positionals[0]);
  }
  if (booleanFlag(parsed, "help", false)) {
    return printHelp(command);
  }
  if (command === "" || command === "--help") {
    return printHelp();
  }
  validateKnownFlags(command, parsed);
  switch (command) {
    case "login":
      await login({ deviceCode: booleanFlag(parsed, "device-code", false) });
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
      return output({ authenticated: true, ...(await client.whoami()) }, parsed.global);
    case "publish":
      if (booleanFlag(parsed, "ephemeral", false)) {
        return publishEphemeral(parsed);
      }
      return publish(parsed, client);
    case "pull":
      return stringFlag(parsed, "output") ? pullDirectory(parsed, client) : pull(parsed, client);
    case "pin":
    case "unpin":
      return pin(parsed, client, command === "pin");
    case "list":
      return list(parsed, client);
    case "delete":
      return deleteArtifact(parsed, client);
    case "usage":
      return output(await client.usage.get(), parsed.global);
    case "edit":
      return edit(parsed, client);
    case "download":
      return download(parsed, client);
    case "feedback":
      return feedback(parsed, client);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

const GLOBAL_FLAG_NAMES = new Set(["json", "quiet", "color", "help", "version"]);

const COMMAND_FLAG_NAMES: Record<string, readonly string[]> = {
  login: ["device-code"],
  logout: [],
  whoami: [],
  feedback: [],
  publish: [
    "claim-code",
    "artifact-id",
    "title",
    "entrypoint",
    "ephemeral",
    "to",
    "mirror",
    "delete",
    "pin",
    "dry-run",
    "exclude",
  ],
  pull: ["revision-id", "output", "overwrite", "dry-run"],
  pin: [],
  unpin: [],
  list: ["cursor"],
  delete: ["yes"],
  usage: [],
  edit: ["edits"],
  download: ["revision-id", "output"],
  version: [],
  upgrade: [],
};

function validateKnownFlags(command: string, parsed: Parsed): void {
  const commandFlags = COMMAND_FLAG_NAMES[command];
  if (!commandFlags) {
    return;
  }
  const allowed = new Set([...GLOBAL_FLAG_NAMES, ...commandFlags]);
  const unknown = [...parsed.flags.keys()].filter((name) => !allowed.has(name)).sort();
  if (unknown.length === 0) {
    return;
  }
  throw new AgentPasteError({
    code: "invalid_request",
    message: `Unknown option${unknown.length === 1 ? "" : "s"}: ${unknown.map((name) => `--${name}`).join(", ")}`,
    status: 400,
  });
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
    return output({ status: "no_credential" }, global, "No stored login credential. Nothing to remove.");
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
  for (const flag of ["to", "mirror", "delete", "pin", "dry-run", "exclude"]) {
    if (parsed.flags.has(flag))
      throw new AgentPasteError({
        code: "invalid_request",
        status: 400,
        message: `--${flag} is unavailable with --ephemeral`,
      });
  }
  const preflight = await preparePublish(parsed, {
    allowArtifactId: false,
    usagePolicy: {
      ...mvpUsagePolicy,
      file_size_cap_bytes: 10 * 1024 * 1024,
      artifact_size_cap_bytes: 25 * 1024 * 1024,
      file_count_cap: 100,
    },
  });
  const prepared = await digestPublish(preflight);
  validatePublishUsage(prepared.files, preflight.usagePolicy);
  await noteEphemeralCredentialPrecedence();
  const claimCodeFlag = stringFlag(parsed, "claim-code")?.trim();
  const parsedClaimCode = claimCodeFlag ? ClaimCode.safeParse(claimCodeFlag) : undefined;
  const claimCode = parsedClaimCode?.success ? parsedClaimCode.data : undefined;
  const provisionClient = unauthenticatedClient();
  const provisioned = await (deps.provision ?? ((options) => provisionClient.ephemeral.provision(options)))({
    ...(claimCode ? { claimCode } : {}),
  });
  const publishClient =
    deps.createPublishClient?.(provisioned.api_key_secret, {
      apiBaseUrl: provisionClient.apiBaseUrl,
      uploadBaseUrl: provisionClient.uploadBaseUrl,
    }) ??
    new ApiClient({
      apiBaseUrl: provisionClient.apiBaseUrl,
      uploadBaseUrl: provisionClient.uploadBaseUrl,
      auth: { type: "api_key", apiKey: provisioned.api_key_secret },
      ...(claimCode ? { defaultHeaders: { [CLAIM_CODE_HEADER]: claimCode } } : {}),
    });
  const mode = outputModeFor(parsed.global);
  const policy = await publishClient.usagePolicy();
  validatePublishUsage(prepared.files, policy);
  const result = await runPreparedPublish(publishClient, mode, prepared);
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

// Read one stored file's content for the owning member (ADR 0090). Default
// output is cat-like: the raw text body to stdout, so `agent-paste pull <id> <remote-path>
//  > file` works. --json emits structured metadata (text body inline; binary and
// oversize files carry no body — fetch those via the content URL). Plain mode refuses
// a binary file (raw bytes would corrupt a terminal / piped text).
async function pull(parsed: Parsed, client: ApiClient) {
  const artifactReference = ArtifactReference.parse(requiredArg(parsed, 0, "artifact-id"));
  const rawFilePath = requiredArg(parsed, 1, "remote-path");
  const parsedFilePath = FilePath.safeParse(rawFilePath);
  if (!parsedFilePath.success) {
    throw new Error(
      "remote-path must be a relative file path inside the Artifact; redirect stdout to write a local file",
    );
  }
  const filePath = parsedFilePath.data;
  const revisionId = stringFlag(parsed, "revision-id");
  const view = revisionId
    ? await client.artifacts.getRevisionAgentView(artifactReference, revisionId)
    : await client.artifacts.getAgentView(artifactReference);
  const artifactId = view.artifact_id;
  const remoteFile = view.files.find((candidate) => candidate.path === filePath);
  if (!remoteFile) {
    throw new AgentPasteError({
      code: "not_found",
      message: `${filePath} is not present in Revision ${view.revision_id}`,
      status: 404,
    });
  }
  const file = await client.artifacts.readFile(artifactId, filePath, view.revision_id);

  if (parsed.global.json) {
    return output(
      {
        path: file.path,
        sha256: file.sha256,
        size_bytes: file.size_bytes,
        content_type: file.content_type,
        is_binary: file.is_binary,
        url: remoteFile.url,
        ...(file.body !== undefined ? { body: file.body } : {}),
      },
      parsed.global,
    );
  }
  if (file.is_binary) {
    throw new Error(`${file.path} is binary; use --json for metadata and its content URL`);
  }
  if (file.body === undefined) {
    throw new Error(`${file.path} is ${file.size_bytes} bytes, too large to inline; use --json for its content URL`);
  }
  // The body IS pull's result (cat-like), not a human summary, so --quiet does not
  // suppress it — like --quiet --json still emitting the object. Otherwise
  // `pull <id> <remote-path> --quiet > file` would silently write an empty file.
  await writeStdout(file.body);
}

function printHelp(topic?: string) {
  if (topic === "publish") return writeStdout(PUBLISH_HELP_TEXT);
  if (topic === "pull") return writeStdout(PULL_HELP_TEXT);
  return writeStdout(HELP_TEXT);
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
