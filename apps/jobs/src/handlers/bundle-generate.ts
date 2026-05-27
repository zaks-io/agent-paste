import { shouldSkipRevisionQueueWork } from "@agent-paste/commands";
import { USAGE_POLICY } from "@agent-paste/config";
import { BundleGenerateMessage } from "@agent-paste/contracts";
import { bundleKeyFor } from "@agent-paste/db";
import { ZodError } from "zod";
import { markBundleFailed, markBundleReady } from "../bundle/bundle-state.js";
import { buildRevisionZip } from "../bundle/generate-zip.js";
import { resolveSqlExecutor } from "../db.js";
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
  body: ReadableStream | ArrayBuffer | null;
};

async function readObjectBytes(object: R2ObjectWithBody): Promise<Uint8Array> {
  if (object.body instanceof ArrayBuffer) {
    return new Uint8Array(object.body);
  }
  if (object.body instanceof ReadableStream) {
    return new Uint8Array(await new Response(object.body).arrayBuffer());
  }
  return new Uint8Array();
}

export async function handleBundleGenerateBatch(messages: readonly QueueMessage[], env: Env): Promise<void> {
  const executor = resolveSqlExecutor(env);
  if (!executor) {
    throw new Error("database_unavailable");
  }

  for (const message of messages) {
    try {
      const payload = BundleGenerateMessage.parse(message.body);
      const state = await loadRevisionState(executor, payload.workspace_id, payload.revision_id);
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
      if (!getObject || !putObject) {
        throw new Error("artifacts_bucket_missing");
      }

      const files = await loadRevisionFiles(executor, payload.artifact_id, payload.revision_id);
      const fileBytes: Array<{ path: string; bytes: Uint8Array }> = [];
      for (const file of files) {
        const object = await getObject(file.r2_key);
        if (!object?.body) {
          throw new Error(`missing_r2_object:${file.path}`);
        }
        fileBytes.push({ path: file.path, bytes: await readObjectBytes({ body: object.body }) });
      }

      const zipBytes = buildRevisionZip(fileBytes);
      if (zipBytes.byteLength > USAGE_POLICY.bundle_size_cap_bytes) {
        await markBundleFailed(executor, payload.workspace_id, payload.revision_id);
        logOpError("queue.bundle_generate.size_cap_exceeded", {
          revision_id: payload.revision_id,
          bundle_size_bytes: zipBytes.byteLength,
          bundle_size_cap_bytes: USAGE_POLICY.bundle_size_cap_bytes,
        });
        message.ack();
        continue;
      }

      const bundleKey = bundleKeyFor(payload.artifact_id, payload.revision_id);
      await putObject(bundleKey, zipBytes, {
        httpMetadata: { contentType: "application/zip" },
      });
      await markBundleReady(executor, payload.workspace_id, payload.revision_id, zipBytes.byteLength);
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
      await markBundleFailed(executor, payload.workspace_id, payload.revision_id);
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
