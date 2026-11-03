import { BytePurgeMessage } from "@agent-paste/contracts";
import { contentCapabilityObjectKey } from "@agent-paste/tokens/content-capability";
import { withQueueMessageTrace } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { resolveSqlExecutor, withWorkspaceScope } from "../db.js";
import type { Env, QueueMessage } from "../env.js";
import { logOp, logOpError } from "../op-log.js";
import { deletePrefixes } from "../r2-purge.js";
import { assertArtifactScopedPrefixes, BytePurgePrefixEnvMismatchError } from "./validation.js";

export async function handleBytePurgeBatch(messages: readonly QueueMessage[], env: Env): Promise<void> {
  const bucket = env.ARTIFACTS;
  if (!bucket) {
    throw new Error("artifacts_bucket_missing");
  }

  for (const message of messages) {
    await withQueueMessageTrace(message.body, "byte-purge", async () => {
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
          await deleteCapabilityManifest(bucket, payload.capability_id);
        }
        const deleted = await deletePrefixes(bucket, payload.prefixes);
        if (payload.reason === "upload_cleanup") {
          const executor = resolveSqlExecutor(env);
          if (!executor || !payload.upload_session_id) throw new Error("upload_cleanup_database_missing");
          await withWorkspaceScope(executor, payload.workspace_id).query(
            `delete from upload_session_files f using upload_sessions s
             where f.upload_session_id=s.id and s.id=$1 and s.workspace_id=$2
               and s.artifact_id=$3 and s.revision_id=$4 and s.status='expired'
               and f.storage_kind='revision'
               and exists (select 1 from unnest($5::text[]) p where starts_with(f.r2_key,p))`,
            [
              payload.upload_session_id,
              payload.workspace_id,
              payload.artifact_id,
              payload.revision_id,
              payload.prefixes,
            ],
          );
        }
        logOp("queue.byte_purge.succeeded", {
          artifact_id: payload.artifact_id,
          revision_id: payload.revision_id,
          reason: payload.reason,
          capability_manifest_deleted: Boolean(payload.capability_id),
          deleted_objects: deleted,
        });
        message.ack();
      } catch (error) {
        Sentry.getActiveSpan()?.setStatus({ code: 2, message: "internal_error" });
        logOpError("queue.byte_purge.failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        message.retry();
      }
    });
  }
}

async function deleteCapabilityManifest(bucket: NonNullable<Env["ARTIFACTS"]>, capabilityId: string): Promise<void> {
  await bucket.delete([contentCapabilityObjectKey(capabilityId)]);
}
