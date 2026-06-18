import { shouldSkipRevisionQueueWork } from "@agent-paste/commands";
import { isBillingEnabled, resolveUsagePolicy, type WorkspacePlan } from "@agent-paste/config";
import type { BundleGenerateMessage } from "@agent-paste/contracts";
import { bundleKeyFor, type SqlExecutor, storageEnvSegment, withSqlQuerySource } from "@agent-paste/db";
import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import { encryptArtifactBytes } from "@agent-paste/storage";
import { markBundleFailed, markBundleReady } from "../bundle/bundle-state.js";
import { buildRevisionZip } from "../bundle/generate-zip.js";
import { withWorkspaceScope } from "../db.js";
import type { Env } from "../env.js";
import { logOp, logOpError } from "../op-log.js";
import { readRevisionFileBytes } from "./revision-file-bytes.js";

type RevisionRow = {
  status: string;
  artifact_status: string;
  bundle_status: string;
};

type RevisionFileRow = {
  path: string;
  r2_key: string;
};

type R2GetObject = NonNullable<NonNullable<Env["ARTIFACTS"]>["get"]>;
type R2PutObject = NonNullable<NonNullable<Env["ARTIFACTS"]>["put"]>;

type BundleArtifactsBinding = {
  get: R2GetObject;
  put: R2PutObject;
};

type BundleEncryptionRing = NonNullable<ReturnType<typeof artifactBytesEncryptionRingFromEnv>>;

export type BundleGenerateSkipReason = "missing_revision" | ReturnType<typeof shouldSkipRevisionQueueWork>;

export type BundleGenerateMessageOutcome =
  | { kind: "skip"; reason: BundleGenerateSkipReason }
  | { kind: "size_cap_exceeded" }
  | { kind: "ready"; bundleSizeBytes: number };

export async function processBundleGenerateMessage(
  payload: BundleGenerateMessage,
  env: Env,
  executor: SqlExecutor,
): Promise<BundleGenerateMessageOutcome> {
  const scoped = withWorkspaceScope(executor, payload.workspace_id);
  const skipReason = await resolveBundleGenerateSkipReason(scoped, payload);
  if (skipReason) {
    if (skipReason !== "missing_revision") {
      logOp("queue.bundle_generate.skipped", {
        revision_id: payload.revision_id,
        reason: skipReason,
      });
    }
    return { kind: "skip", reason: skipReason };
  }

  const artifacts = resolveBundleArtifactsBinding(env);
  if (!artifacts) {
    throw new Error("artifacts_bucket_missing");
  }
  const encryptionRing = artifactBytesEncryptionRingFromEnv(env);
  if (!encryptionRing) {
    throw new Error("artifact_bytes_ring_missing");
  }

  const fileBytes = await loadBundleRevisionFileBytes({
    scoped,
    payload,
    getObject: artifacts.get,
    encryptionRing,
  });
  const usagePolicy = await loadWorkspaceUsagePolicy(scoped, payload.workspace_id, env);
  const zipBytes = buildRevisionZip(fileBytes);
  if (zipBytes.byteLength > usagePolicy.bundle_size_cap_bytes) {
    await markBundleFailed(scoped, payload.workspace_id, payload.revision_id);
    logOpError("queue.bundle_generate.size_cap_exceeded", {
      revision_id: payload.revision_id,
      bundle_size_bytes: zipBytes.byteLength,
      bundle_size_cap_bytes: usagePolicy.bundle_size_cap_bytes,
    });
    return { kind: "size_cap_exceeded" };
  }

  await storeReadyBundle({
    env,
    payload,
    artifacts,
    encryptionRing,
    zipBytes,
    scoped,
  });
  logOp("queue.bundle_generate.ready", {
    revision_id: payload.revision_id,
    bundle_size_bytes: zipBytes.byteLength,
  });
  return { kind: "ready", bundleSizeBytes: zipBytes.byteLength };
}

async function resolveBundleGenerateSkipReason(
  scoped: SqlExecutor,
  payload: BundleGenerateMessage,
): Promise<BundleGenerateSkipReason | null> {
  const state = await loadRevisionState(scoped, payload.workspace_id, payload.revision_id);
  if (!state) {
    return "missing_revision";
  }
  const skip = shouldSkipRevisionQueueWork({
    revisionStatus: state.status,
    artifactStatus: state.artifact_status,
    bundleStatus: state.bundle_status,
  });
  return skip ?? null;
}

function resolveBundleArtifactsBinding(env: Env): BundleArtifactsBinding | null {
  const artifacts = env.ARTIFACTS;
  if (!artifacts?.get || !artifacts.put) {
    return null;
  }
  return {
    get: artifacts.get.bind(artifacts),
    put: artifacts.put.bind(artifacts),
  };
}

async function loadBundleRevisionFileBytes(input: {
  scoped: SqlExecutor;
  payload: BundleGenerateMessage;
  getObject: R2GetObject;
  encryptionRing: BundleEncryptionRing;
}): Promise<Array<{ path: string; bytes: Uint8Array }>> {
  const files = await loadRevisionFiles(input.scoped, input.payload.artifact_id, input.payload.revision_id);
  const fileBytes: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const file of files) {
    const object = await input.getObject(file.r2_key);
    if (!object?.body) {
      throw new Error(`missing_r2_object:${file.path}`);
    }
    fileBytes.push({
      path: file.path,
      bytes: await readRevisionFileBytes({
        object,
        objectKey: file.r2_key,
        workspaceId: input.payload.workspace_id,
        encryptionRing: input.encryptionRing,
      }),
    });
  }
  return fileBytes;
}

async function storeReadyBundle(input: {
  env: Env;
  payload: BundleGenerateMessage;
  artifacts: BundleArtifactsBinding;
  encryptionRing: BundleEncryptionRing;
  zipBytes: Uint8Array;
  scoped: SqlExecutor;
}): Promise<void> {
  const bundleKey = bundleKeyFor({
    workspaceId: input.payload.workspace_id,
    artifactId: input.payload.artifact_id,
    revisionId: input.payload.revision_id,
    storageEnv: storageEnvSegment(input.env.AGENT_PASTE_ENV),
  });
  const encryptedBundle = await encryptArtifactBytes({
    plaintext: input.zipBytes,
    rootSecret: input.encryptionRing.signingSecret(),
    kid: input.encryptionRing.signingKid,
    context: {
      workspaceId: input.payload.workspace_id,
      artifactId: input.payload.artifact_id,
      revisionId: input.payload.revision_id,
      normalizedPath: "bundle.zip",
    },
  });
  await input.artifacts.put(bundleKey, encryptedBundle.ciphertext, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: encryptedBundle.customMetadata,
  });
  await markBundleReady(input.scoped, input.payload.workspace_id, input.payload.revision_id, input.zipBytes.byteLength);
}

async function loadWorkspaceUsagePolicy(executor: SqlExecutor, workspaceId: string, env: Env) {
  return withSource("loadWorkspaceUsagePolicy", async () => {
    const result = await executor.query<{ plan: WorkspacePlan }>(`select plan from workspaces where id = $1`, [
      workspaceId,
    ]);
    const plan = result.rows[0]?.plan ?? "free";
    return resolveUsagePolicy({ plan, billingEnabled: isBillingEnabled(env.BILLING_ENABLED) });
  });
}

async function loadRevisionState(
  executor: SqlExecutor,
  workspaceId: string,
  revisionId: string,
): Promise<RevisionRow | null> {
  return withSource("loadRevisionState", async () => {
    const result = await executor.query<RevisionRow>(
      `select r.status, a.status as artifact_status, r.bundle_status
     from revisions r
     inner join artifacts a on a.id = r.artifact_id
     where r.workspace_id = $1 and r.id = $2`,
      [workspaceId, revisionId],
    );
    return result.rows[0] ?? null;
  });
}

async function loadRevisionFiles(
  executor: SqlExecutor,
  artifactId: string,
  revisionId: string,
): Promise<RevisionFileRow[]> {
  return withSource("loadRevisionFiles", async () => {
    const result = await executor.query<RevisionFileRow>(
      `select path, r2_key
     from artifact_files
     where artifact_id = $1 and revision_id = $2
     order by path asc`,
      [artifactId, revisionId],
    );
    return result.rows;
  });
}

function withSource<T>(functionName: string, run: () => T): T {
  return withSqlQuerySource(
    {
      filepath: "apps/jobs/src/handlers/bundle-generate-orchestration.ts",
      functionName,
      namespace: "apps.jobs.src.handlers.bundle-generate-orchestration",
    },
    run,
  );
}
