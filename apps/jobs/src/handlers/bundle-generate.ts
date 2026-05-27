import { runCommand, shouldSkipRevisionQueueWork } from "@agent-paste/commands";
import { BundleGenerateMessage } from "@agent-paste/contracts";
import { resolveSqlExecutor } from "../db.js";
import type { Env, QueueMessage } from "../env.js";
import { logOp, logOpError } from "../op-log.js";

type RevisionRow = {
  status: string;
  artifact_status: string;
  bundle_status: string;
};

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

      // Bundle zip generation is implemented in a follow-up ticket; topology records pending work only.
      logOp("queue.bundle_generate.deferred", {
        revision_id: payload.revision_id,
        bundle_status: state.bundle_status,
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
      await runCommand({
        executor,
        actor: { type: "system", id: "bundle_generate", workspaceId: payload.workspace_id },
        operation: "bundle.mark_failed",
        idempotencyKey: payload.revision_id,
        workspaceId: payload.workspace_id,
        handler: async (tx) => {
          await tx.query(
            `update revisions
             set bundle_status = 'failed', bundle_status_updated_at = now()
             where workspace_id = $1 and id = $2`,
            [payload.workspace_id, payload.revision_id],
          );
          return { result: { revision_id: payload.revision_id, bundle_status: "failed" as const } };
        },
      });
      logOpError("queue.bundle_generate.final_failure", {
        revision_id: payload.revision_id,
        workspace_id: payload.workspace_id,
        final_failure: true,
      });
      message.ack();
    } catch (error) {
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
