import type { BytePurgeMessage } from "@agent-paste/contracts";
import type { SqlExecutor } from "@agent-paste/db";
import { applyArtifactPurgeSideEffects as applyArtifactPurgeSideEffectsCore } from "@agent-paste/db";
import type { Env } from "../env.js";
import { logOpError } from "../op-log.js";
import { processSmokeSyncBytePurge } from "../smoke-sync-byte-purge.js";

export async function applyArtifactPurgeSideEffects(
  env: Env,
  executor: SqlExecutor,
  input: {
    workspaceId: string;
    artifactId: string;
    revisionId: string;
    reason: BytePurgeMessage["reason"];
    uploadSessionId?: string | null;
  },
): Promise<{ denylistWritten: boolean; enqueued: boolean }> {
  const sideEffects = await applyArtifactPurgeSideEffectsCore(env, executor, input, {
    afterEnqueue: async (message) => {
      await processSmokeSyncBytePurge(env, message);
    },
  });
  if (!sideEffects.denylistWritten && input.artifactId && env.DENYLIST) {
    logOpError("lifecycle.denylist.failed", { artifact_id: input.artifactId });
  }
  if (sideEffects.denylistWritten && !sideEffects.enqueued) {
    if (!env.BYTE_PURGE_QUEUE) {
      logOpError("lifecycle.byte_purge.queue_missing", { artifact_id: input.artifactId });
    } else {
      logOpError("lifecycle.byte_purge.enqueue_failed", { artifact_id: input.artifactId });
    }
  }
  return sideEffects;
}
