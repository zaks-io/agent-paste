import type { SqlExecutor } from "@agent-paste/db";
import { enqueueRevisionBytePurge as enqueueRevisionBytePurgeCore, type RevisionBytePurgeInput } from "@agent-paste/db";
import type { Env } from "../env.js";
import { logOpError } from "../op-log.js";
import { processSmokeSyncBytePurge } from "../smoke-sync-byte-purge.js";

export type { RevisionBytePurgeInput };

export async function enqueueRevisionBytePurge(
  env: Env,
  executor: SqlExecutor,
  input: RevisionBytePurgeInput,
): Promise<boolean> {
  const enqueued = await enqueueRevisionBytePurgeCore(env, executor, input, {
    afterEnqueue: async (message) => {
      await processSmokeSyncBytePurge(env, message);
    },
  });
  if (!enqueued) {
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
  return enqueued;
}
