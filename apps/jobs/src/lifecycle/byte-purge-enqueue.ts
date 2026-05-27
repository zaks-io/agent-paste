import type { SqlExecutor } from "@agent-paste/db";
import { type ArtifactBytePurgeInput, enqueueArtifactBytePurge as enqueueArtifactBytePurgeCore } from "@agent-paste/db";
import type { Env } from "../env.js";
import { logOpError } from "../op-log.js";
import { processSmokeSyncBytePurge } from "../smoke-sync-byte-purge.js";

export type { ArtifactBytePurgeInput };

export async function enqueueArtifactBytePurge(
  env: Env,
  executor: SqlExecutor,
  input: ArtifactBytePurgeInput,
): Promise<boolean> {
  const enqueued = await enqueueArtifactBytePurgeCore(env, executor, input, {
    afterEnqueue: async (message) => {
      await processSmokeSyncBytePurge(env, message);
    },
  });
  if (!enqueued) {
    if (!env.BYTE_PURGE_QUEUE) {
      logOpError("lifecycle.byte_purge.queue_missing", { artifact_id: input.artifactId });
    } else {
      logOpError("lifecycle.byte_purge.enqueue_failed", { artifact_id: input.artifactId });
    }
  }
  return enqueued;
}
