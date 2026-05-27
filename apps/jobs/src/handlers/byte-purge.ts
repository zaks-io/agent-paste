import { BytePurgeMessage } from "@agent-paste/contracts";
import type { Env, QueueMessage } from "../env.js";
import { logOp, logOpError } from "../op-log.js";
import { deletePrefixes } from "../r2-purge.js";

export async function handleBytePurgeBatch(messages: readonly QueueMessage[], env: Env): Promise<void> {
  if (!env.ARTIFACTS) {
    throw new Error("artifacts_bucket_missing");
  }

  for (const message of messages) {
    try {
      const payload = BytePurgeMessage.parse(message.body);
      const deleted = await deletePrefixes(env.ARTIFACTS, payload.prefixes);
      logOp("queue.byte_purge.succeeded", {
        artifact_id: payload.artifact_id,
        revision_id: payload.revision_id,
        reason: payload.reason,
        deleted_objects: deleted,
      });
      message.ack();
    } catch (error) {
      logOpError("queue.byte_purge.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry();
    }
  }
}
