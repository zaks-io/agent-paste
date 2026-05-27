import type { BytePurgeMessage } from "@agent-paste/contracts";
import type { SqlExecutor } from "@agent-paste/db";
import { applyRevisionPurgeSideEffects as applyRevisionPurgeSideEffectsCore } from "@agent-paste/db";
import type { Env } from "../env.js";
import { logOpError } from "../op-log.js";
import { processSmokeSyncBytePurge } from "../smoke-sync-byte-purge.js";

export async function applyRevisionPurgeSideEffects(
  env: Env,
  executor: SqlExecutor,
  input: {
    workspaceId: string;
    artifactId: string;
    revisionId: string;
    reason: BytePurgeMessage["reason"];
  },
): Promise<{ denylistWritten: boolean; enqueued: boolean }> {
  const sideEffects = await applyRevisionPurgeSideEffectsCore(env, executor, input, {
    afterEnqueue: async (message) => {
      await processSmokeSyncBytePurge(env, message);
    },
  });
  if (!sideEffects.denylistWritten && input.revisionId && env.DENYLIST) {
    logOpError("lifecycle.revision_denylist.failed", { revision_id: input.revisionId });
  }
  if (sideEffects.denylistWritten && !sideEffects.enqueued) {
    if (!env.BYTE_PURGE_QUEUE) {
      logOpError("lifecycle.byte_purge.queue_missing", {
        artifact_id: input.artifactId,
        revision_id: input.revisionId,
      });
    } else {
      logOpError("lifecycle.byte_purge.enqueue_failed", {
        artifact_id: input.artifactId,
        revision_id: input.revisionId,
      });
    }
  }
  return sideEffects;
}
