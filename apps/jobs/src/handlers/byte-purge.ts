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
      assertArtifactScopedPrefixes(payload);
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

type PurgeScope = Pick<BytePurgeMessage, "workspace_id" | "artifact_id" | "prefixes">;

// Safety property: a message may only purge keys belonging to its own
// artifact. Revision files use artifact-scoped keys; derived bundles use
// env-scoped keys (ADR 0021), which must still pin workspace and artifact.
function assertArtifactScopedPrefixes(payload: PurgeScope): void {
  if (payload.prefixes.length === 0 || !payload.prefixes.every((prefix) => isArtifactScopedPrefix(payload, prefix))) {
    throw new Error("byte_purge_prefix_outside_artifact_scope");
  }
}

const ENV_SCOPE_PATTERN = /^env\/[^/]+\/workspaces\/([^/]+)\//;

function isArtifactScopedPrefix(payload: PurgeScope, prefix: string): boolean {
  const artifactPrefix = `artifacts/${payload.artifact_id}/`;
  if (prefix.startsWith(artifactPrefix)) {
    return true;
  }
  const envScope = ENV_SCOPE_PATTERN.exec(prefix);
  return (
    envScope !== null &&
    envScope[1] === payload.workspace_id &&
    prefix.slice(envScope[0].length).startsWith(artifactPrefix)
  );
}
