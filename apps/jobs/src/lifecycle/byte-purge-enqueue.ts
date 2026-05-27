import { BytePurgeMessage, type BytePurgeMessage as BytePurgePayload } from "@agent-paste/contracts";
import type { SqlExecutor } from "@agent-paste/db";
import type { Env } from "../env.js";
import { logOpError } from "../op-log.js";
import { processSmokeSyncBytePurge } from "../smoke-sync-byte-purge.js";
import { artifactPurgePrefix } from "./artifact-prefix.js";

export type ArtifactBytePurgeInput = {
  workspaceId: string;
  artifactId: string;
  revisionId: string;
  reason: BytePurgePayload["reason"];
  uploadSessionId?: string | null;
};

export async function enqueueArtifactBytePurge(
  env: Env,
  executor: SqlExecutor,
  input: ArtifactBytePurgeInput,
): Promise<boolean> {
  if (!env.BYTE_PURGE_QUEUE) {
    logOpError("lifecycle.byte_purge.queue_missing", { artifact_id: input.artifactId });
    return false;
  }

  const message = BytePurgeMessage.parse({
    type: "byte.purge.v1",
    workspace_id: input.workspaceId,
    artifact_id: input.artifactId,
    revision_id: input.revisionId,
    upload_session_id: input.uploadSessionId ?? null,
    prefixes: [artifactPurgePrefix(input.artifactId)],
    reason: input.reason,
  });

  try {
    await env.BYTE_PURGE_QUEUE.send(message);
    await processSmokeSyncBytePurge(env, message);
  } catch (error) {
    logOpError("lifecycle.byte_purge.enqueue_failed", {
      artifact_id: input.artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  // Operational bookkeeping outside runCommand (ADR 0049).
  try {
    const result = await executor.query<{ id: string }>(
      `update revisions
       set bytes_purge_enqueued_at = now()
       where workspace_id = $1 and id = $2 and artifact_id = $3
       returning id`,
      [input.workspaceId, input.revisionId, input.artifactId],
    );
    if (result.rows.length === 0) {
      logOpError("lifecycle.byte_purge.bookkeeping_failed", {
        artifact_id: input.artifactId,
        error: "revision_not_updated",
      });
      return false;
    }
  } catch (error) {
    logOpError("lifecycle.byte_purge.bookkeeping_failed", {
      artifact_id: input.artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  return true;
}
