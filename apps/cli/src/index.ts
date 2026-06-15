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
import { ArtifactId, FilePath, RenderMode, RevisionId } from "@agent-paste/contracts";
import {
  booleanFlag,
  type GlobalFlags,
  output,
  outputModeFor,
  type Parsed,
  parseArgs,
  requiredArg,
  shellQuote,
  stringFlag,
  writeStdout,
} from "./cli-args.js";
import { type Credential, deleteCredential, isCredentialExpired, loadCredential } from "./credentials.js";
import { edit } from "./edit.js";
import { HELP_TEXT } from "./help.js";
import {
  contentTypeForLocalPath,
  inferPublishOptions,
  sha256HexForFile,
  validateFilesAgainstUsagePolicy,
  walkLocalPath,
} from "./local.js";
import { login } from "./login.js";
import { loadManifestCache, type ManifestCacheFile, saveManifestCache } from "./manifest-cache.js";
import {
  ephemeralClaimUrl,
  formatEphemeralPublishResult,
  formatMakePublic,
  formatPublishResult,
} from "./publish-format.js";
import { apiClientTransport } from "./publish-transport.js";
import { createProgress, exitCodeFor, formatError, type OutputMode } from "./render.js";
import { buildRevisePlan, isBaseUnusableError, type LocalFileWithDigest, type RevisePlan } from "./revise.js";
import { commandInvocation, detectChannel, runUpdateCheck, signedOutHint } from "./update-check.js";
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
  if (command === "" || command === "help" || command === "--help" || booleanFlag(parsed, "help", false)) {
    return printHelp();
  }
  switch (command) {
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
    case "make-public":
      return makePublic(parsed, client);
    case "pull":
      return pull(parsed, client);
    case "edit":
      return edit(parsed, client);
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

function wholePublishFile(file: LocalFileWithDigest): PublishFile {
  return {
    path: file.path,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    contentType: contentTypeForLocalPath(file.path),
    read: () => fs.readFile(file.absolutePath),
  };
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
  const filesWithDigest: LocalFileWithDigest[] = files.map((file) => {
    const digest = digestByPath.get(file.path);
    if (!digest) {
      throw new Error(`Missing digest for ${file.path}`);
    }
    return { ...file, sha256: digest.sha256, sizeBytes: digest.sizeBytes };
  });

  const wholeManifest = (): PublishFile[] => filesWithDigest.map(wholePublishFile);
  const fullTree = (): ManifestCacheFile[] =>
    filesWithDigest.map((file) => ({ path: file.path, sha256: file.sha256, size_bytes: file.sizeBytes }));

  const artifactIdFlag = stringFlag(parsed, "artifact-id");
  const artifactId = artifactIdFlag ? ArtifactId.parse(artifactIdFlag) : undefined;

  // On a revise with a matching local cache, send only changed/added files (some
  // as verified unified diffs) against the base Revision; unchanged files inherit.
  // No cache (first publish elsewhere / fresh machine) => a full whole-blob publish.
  const cache = artifactId ? await loadManifestCache(artifactId) : null;
  const built =
    artifactId && cache
      ? await buildRevisePlan({ client, artifactId, cache, files: filesWithDigest, entrypoint: inferred.entrypoint })
      : null;
  // A no-op delta (working tree identical to the base: nothing changed, added, or
  // deleted) cannot be sent as a partial manifest — the server requires a delta to
  // carry at least one change. Fall back to a full whole-blob publish, which always
  // produces a valid request and a fresh Revision (e.g. re-publishing an unchanged
  // dir, or a metadata-only revise like --title).
  const plan = built && built.publishFiles.length === 0 && built.deletedPaths.length === 0 ? null : built;

  const progress = createProgress(mode);
  const runOnce = (revise: RevisePlan | null) =>
    runSharedPublish(apiClientTransport(client), {
      files: revise ? revise.publishFiles : wholeManifest(),
      title: inferred.title,
      entrypoint: inferred.entrypoint,
      ...(explicitRenderMode ? { renderMode: explicitRenderMode } : {}),
      ...(artifactId ? { artifactId } : {}),
      ...(revise
        ? {
            baseRevisionId: RevisionId.parse(revise.baseRevisionId),
            ...(revise.deletedPaths.length > 0
              ? { deletedPaths: revise.deletedPaths.map((p) => FilePath.parse(p)) }
              : {}),
          }
        : {}),
      idempotencyKey: createIdempotencyKey("cli_publish"),
      onUploadProgress: ({ uploadedFiles, totalToUpload, uploadedBytes }) =>
        progress.update({ done: uploadedFiles, total: totalToUpload, bytes: uploadedBytes }),
    });

  let outcome: Awaited<ReturnType<typeof runOnce>>;
  try {
    outcome = await runOnce(plan);
  } catch (error) {
    // A cached base that the server can no longer use (concurrent revise, retained
    // base, non-inheritable file) is recoverable: drop the partial manifest and
    // re-publish the whole working dir, which is always on disk.
    if (plan && isBaseUnusableError(error)) {
      progress.done();
      outcome = await runOnce(null);
    } else {
      throw error;
    }
  }
  progress.done();

  // Seed the cache with the full effective tree so the next revise diffs correctly.
  if (outcome.result.artifact_id && outcome.result.revision_id) {
    await saveManifestCache(outcome.result.artifact_id, {
      revision_id: outcome.result.revision_id,
      files: plan ? plan.effectiveTree : fullTree(),
    });
  }

  // Publish is content-only and private: one link to hand the user, the private
  // viewer URL (`/v/<id>`), identical to what the MCP server returns. Going public
  // is a separate, explicit step (`agent-paste make-public <artifact-id>`).
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

// Make an Artifact public: create (or reuse) its revocable Share Link and mint
// the public Access Link Signed URL. Publish stays private; this is the separate,
// explicit verb that opts an Artifact into no-login access. Mirrors the MCP
// make_public tool (accessLinks.create {type:"share"} then accessLinks.mint).
async function makePublic(parsed: Parsed, client: ApiClient) {
  const artifactId = ArtifactId.parse(requiredArg(parsed, 0, "artifact-id"));
  const created = await client.accessLinks.create(
    artifactId,
    { type: "share" },
    createIdempotencyKey("cli_make_public"),
  );
  const minted = await client.accessLinks.mint(created.id);
  const payload = { artifact_id: artifactId, access_link_id: created.id, public_url: minted.url };
  return output(payload, parsed.global, formatMakePublic(outputModeFor(parsed.global), payload));
}

// Read one stored file's content for the owning member (ADR 0090). Default
// output is cat-like: the raw text body to stdout, so `agent-paste pull <id> <path>
//  > file` works. --json emits structured metadata (text body inline; binary and
// oversize files carry no body — fetch those via the content URL). Plain mode refuses
// a binary file (raw bytes would corrupt a terminal / piped text).
async function pull(parsed: Parsed, client: ApiClient) {
  const artifactId = ArtifactId.parse(requiredArg(parsed, 0, "artifact-id"));
  const filePath = requiredArg(parsed, 1, "path");
  const revisionId = stringFlag(parsed, "revision-id");
  const file = await client.artifacts.readFile(artifactId, filePath, revisionId);

  if (parsed.global.json) {
    return output(
      {
        path: file.path,
        sha256: file.sha256,
        size_bytes: file.size_bytes,
        content_type: file.content_type,
        is_binary: file.is_binary,
        ...(file.body !== undefined ? { body: file.body } : {}),
      },
      parsed.global,
    );
  }
  if (file.is_binary) {
    throw new Error(`${file.path} is binary; use --json for metadata and fetch the bytes via the content URL`);
  }
  if (file.body === undefined) {
    throw new Error(`${file.path} is ${file.size_bytes} bytes, too large to inline; fetch via the content URL`);
  }
  // The body IS pull's result (cat-like), not a human summary, so --quiet does not
  // suppress it — like --quiet --json still emitting the object. Otherwise
  // `pull <id> <path> --quiet > file` would silently write an empty file.
  await writeStdout(file.body);
}

function printHelp() {
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
