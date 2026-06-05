import { shouldSkipRevisionQueueWork } from "@agent-paste/commands";
import { isBillingEnabled, resolveUsagePolicy, type WorkspacePlan } from "@agent-paste/config";
import { BundleGenerateMessage } from "@agent-paste/contracts";
import { bundleKeyFor, storageEnvSegment } from "@agent-paste/db";
import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import {
  bytesFromReadableBody,
  decryptArtifactBytesWithKeyRing,
  encryptArtifactBytes,
  isArtifactBytesEncryptionMetadata,
  parseRevisionFileObjectKey,
} from "@agent-paste/storage";
import { ZodError } from "zod";
import { markBundleFailed, markBundleReady } from "../bundle/bundle-state.js";
import { buildRevisionZip } from "../bundle/generate-zip.js";
import { resolveSqlExecutor, withWorkspaceScope } from "../db.js";
import type { Env, QueueMessage } from "../env.js";
import { logOp, logOpError } from "../op-log.js";

type RevisionRow = {
  status: string;
  artifact_status: string;
  bundle_status: string;
};

type RevisionFileRow = {
  path: string;
  r2_key: string;
};

type R2ObjectWithBody = {
  body?: ReadableStream | ArrayBuffer | null;
  customMetadata?: Record<string, string>;
};

async function readRevisionFileBytes(input: {
  object: R2ObjectWithBody;
  objectKey: string;
  workspaceId: string;
  encryptionRing: NonNullable<ReturnType<typeof artifactBytesEncryptionRingFromEnv>>;
}): Promise<Uint8Array> {
  const ciphertext = await bytesFromReadableBody(input.object.body);
  if (!isArtifactBytesEncryptionMetadata(input.object.customMetadata)) {
    throw new Error("artifact_bytes_metadata_missing");
  }
  const keyParts = parseRevisionFileObjectKey(input.objectKey);
  if (!keyParts) {
    throw new Error("artifact_bytes_invalid_object_key");
  }
  return decryptArtifactBytesWithKeyRing({
    ciphertext,
    ring: input.encryptionRing,
    metadata: input.object.customMetadata,
    context: {
      workspaceId: input.workspaceId,
      artifactId: keyParts.artifactId,
      revisionId: keyParts.revisionId,
      normalizedPath: keyParts.path,
    },
  });
}

export async function handleBundleGenerateBatch(messages: readonly QueueMessage[], env: Env): Promise<void> {
  const executor = resolveSqlExecutor(env);
  if (!executor) {
    throw new Error("database_unavailable");
  }

  for (const message of messages) {
    try {
      const payload = BundleGenerateMessage.parse(message.body);
      const scoped = withWorkspaceScope(executor, payload.workspace_id);
      const state = await loadRevisionState(scoped, payload.workspace_id, payload.revision_id);
      if (!state) {
        message.ack();
        continue;
      }

      const skip = shouldSkipRevisionQueueWork({
        revisionStatus: state.status,
        artifactStatus: state.artifact_status,
        bundleStatus: state.bundle_status,
      });
      if (skip) {
        logOp("queue.bundle_generate.skipped", {
          revision_id: payload.revision_id,
          reason: skip,
        });
        message.ack();
        continue;
      }

      const getObject = env.ARTIFACTS?.get;
      const putObject = env.ARTIFACTS?.put;
      const encryptionRing = artifactBytesEncryptionRingFromEnv(env);
      if (!getObject || !putObject || !encryptionRing) {
        throw new Error("artifacts_bucket_missing");
      }

      const files = await loadRevisionFiles(scoped, payload.artifact_id, payload.revision_id);
      const fileBytes: Array<{ path: string; bytes: Uint8Array }> = [];
      for (const file of files) {
        const object = await getObject(file.r2_key);
        if (!object?.body) {
          throw new Error(`missing_r2_object:${file.path}`);
        }
        fileBytes.push({
          path: file.path,
          bytes: await readRevisionFileBytes({
            object,
            objectKey: file.r2_key,
            workspaceId: payload.workspace_id,
            encryptionRing,
          }),
        });
      }

      const usagePolicy = await loadWorkspaceUsagePolicy(scoped, payload.workspace_id, env);
      const zipBytes = buildRevisionZip(fileBytes);
      if (zipBytes.byteLength > usagePolicy.bundle_size_cap_bytes) {
        await markBundleFailed(scoped, payload.workspace_id, payload.revision_id);
        logOpError("queue.bundle_generate.size_cap_exceeded", {
          revision_id: payload.revision_id,
          bundle_size_bytes: zipBytes.byteLength,
          bundle_size_cap_bytes: usagePolicy.bundle_size_cap_bytes,
        });
        message.ack();
        continue;
      }

      const bundleKey = bundleKeyFor({
        workspaceId: payload.workspace_id,
        artifactId: payload.artifact_id,
        revisionId: payload.revision_id,
        storageEnv: storageEnvSegment(env.AGENT_PASTE_ENV),
      });
      const encryptedBundle = await encryptArtifactBytes({
        plaintext: zipBytes,
        rootSecret: encryptionRing.signingSecret(),
        kid: encryptionRing.signingKid,
        context: {
          workspaceId: payload.workspace_id,
          artifactId: payload.artifact_id,
          revisionId: payload.revision_id,
          normalizedPath: "bundle.zip",
        },
      });
      await putObject(bundleKey, encryptedBundle.ciphertext, {
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: encryptedBundle.customMetadata,
      });
      await markBundleReady(scoped, payload.workspace_id, payload.revision_id, zipBytes.byteLength);
      logOp("queue.bundle_generate.ready", {
        revision_id: payload.revision_id,
        bundle_size_bytes: zipBytes.byteLength,
      });
      message.ack();
    } catch (error) {
      logOpError("queue.bundle_generate.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry();
    }
  }
}

export async function handleBundleGenerateDlqBatch(messages: readonly QueueMessage[], env: Env): Promise<void> {
  const executor = resolveSqlExecutor(env);
  if (!executor) {
    throw new Error("database_unavailable");
  }

  for (const message of messages) {
    try {
      const payload = BundleGenerateMessage.parse(message.body);
      await markBundleFailed(
        withWorkspaceScope(executor, payload.workspace_id),
        payload.workspace_id,
        payload.revision_id,
      );
      logOpError("queue.bundle_generate.final_failure", {
        revision_id: payload.revision_id,
        workspace_id: payload.workspace_id,
        final_failure: true,
      });
      message.ack();
    } catch (error) {
      if (error instanceof ZodError) {
        logOpError("queue.bundle_generate.dlq_invalid", {
          error: error.message,
        });
        message.ack();
        continue;
      }
      logOpError("queue.bundle_generate.dlq_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry();
    }
  }
}

async function loadWorkspaceUsagePolicy(
  executor: NonNullable<Awaited<ReturnType<typeof resolveSqlExecutor>>>,
  workspaceId: string,
  env: Env,
) {
  const result = await executor.query<{ plan: WorkspacePlan }>(`select plan from workspaces where id = $1`, [
    workspaceId,
  ]);
  const plan = result.rows[0]?.plan ?? "free";
  return resolveUsagePolicy({ plan, billingEnabled: isBillingEnabled(env.BILLING_ENABLED) });
}

async function loadRevisionState(
  executor: NonNullable<Awaited<ReturnType<typeof resolveSqlExecutor>>>,
  workspaceId: string,
  revisionId: string,
): Promise<RevisionRow | null> {
  const result = await executor.query<RevisionRow>(
    `select r.status, a.status as artifact_status, r.bundle_status
     from revisions r
     inner join artifacts a on a.id = r.artifact_id
     where r.workspace_id = $1 and r.id = $2`,
    [workspaceId, revisionId],
  );
  return result.rows[0] ?? null;
}

async function loadRevisionFiles(
  executor: NonNullable<Awaited<ReturnType<typeof resolveSqlExecutor>>>,
  artifactId: string,
  revisionId: string,
): Promise<RevisionFileRow[]> {
  const result = await executor.query<RevisionFileRow>(
    `select path, r2_key
     from artifact_files
     where artifact_id = $1 and revision_id = $2
     order by path asc`,
    [artifactId, revisionId],
  );
  return result.rows;
}
