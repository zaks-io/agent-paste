import { BytePurgeMessage } from "@agent-paste/contracts";
import { contentCapabilityObjectKey } from "@agent-paste/tokens/content-capability";
import type { Env, QueueMessage } from "../env.js";
import { logOp, logOpError } from "../op-log.js";
import { deletePrefixes } from "../r2-purge.js";
import { assertArtifactScopedPrefixes, BytePurgePrefixEnvMismatchError } from "./validation.js";

export async function handleBytePurgeBatch(messages: readonly QueueMessage[], env: Env): Promise<void> {
  if (!env.ARTIFACTS) {
    throw new Error("artifacts_bucket_missing");
  }

  for (const message of messages) {
    try {
      const payload = BytePurgeMessage.parse(message.body);
      try {
        assertArtifactScopedPrefixes(payload, env.AGENT_PASTE_ENV);
      } catch (error) {
        if (error instanceof BytePurgePrefixEnvMismatchError) {
          logOpError("queue.byte_purge.prefix_env_mismatch", {
            artifact_id: payload.artifact_id,
            revision_id: payload.revision_id,
            prefix: error.prefix,
            prefix_env: error.prefixEnv,
            expected_env: error.expectedEnv,
          });
        }
        throw error;
      }
      if (payload.capability_id) {
        await deleteCapabilityManifest(env.ARTIFACTS, payload.capability_id);
      }
      const deleted = await deletePrefixes(env.ARTIFACTS, payload.prefixes);
      logOp("queue.byte_purge.succeeded", {
        artifact_id: payload.artifact_id,
        revision_id: payload.revision_id,
        reason: payload.reason,
        capability_manifest_deleted: Boolean(payload.capability_id),
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

async function deleteCapabilityManifest(bucket: NonNullable<Env["ARTIFACTS"]>, capabilityId: string): Promise<void> {
  await bucket.delete([contentCapabilityObjectKey(capabilityId)]);
}
