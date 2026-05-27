import { shouldSkipRevisionQueueWork } from "@agent-paste/commands";
import { SafetyScanMessage } from "@agent-paste/contracts";
import { resolveSqlExecutor } from "../db.js";
import type { Env, QueueMessage } from "../env.js";
import { logOp, logOpError } from "../op-log.js";

type RevisionRow = {
  status: string;
  artifact_status: string;
};

export async function handleSafetyScanBatch(messages: readonly QueueMessage[], env: Env): Promise<void> {
  const executor = resolveSqlExecutor(env);
  if (!executor) {
    throw new Error("database_unavailable");
  }

  for (const message of messages) {
    try {
      const payload = SafetyScanMessage.parse(message.body);
      const state = await loadRevisionState(executor, payload.workspace_id, payload.revision_id);
      if (!state) {
        message.ack();
        continue;
      }

      const skip = shouldSkipRevisionQueueWork({
        revisionStatus: state.status,
        artifactStatus: state.artifact_status,
      });
      if (skip) {
        logOp("queue.safety_scan.skipped", {
          revision_id: payload.revision_id,
          reason: skip,
        });
        message.ack();
        continue;
      }

      // Stub scanner: replace warnings in a future ticket; topology acks after state check.
      logOp("queue.safety_scan.stub", {
        revision_id: payload.revision_id,
        scanner_id: payload.scanner_id,
        scanner_version: payload.scanner_version,
      });
      message.ack();
    } catch (error) {
      logOpError("queue.safety_scan.failed", {
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
    `select r.status, a.status as artifact_status
     from revisions r
     inner join artifacts a on a.id = r.artifact_id
     where r.workspace_id = $1 and r.id = $2`,
    [workspaceId, revisionId],
  );
  return result.rows[0] ?? null;
}
