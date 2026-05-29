import { resolveUsagePolicy } from "@agent-paste/config";
import { BytePurgeMessage, type BytePurgeMessage as BytePurgePayload } from "@agent-paste/contracts";
import type { ArtifactBytePurgeHooks, ArtifactInvalidationEnv } from "./artifact-invalidation.js";
import type { SqlExecutor } from "./types.js";

const DENYLIST_EXPIRATION_TTL_SECONDS = resolveUsagePolicy({ billingEnabled: false }).max_ttl_seconds;
const MAX_DENYLIST_ATTEMPTS = 3;

export type RevisionInvalidationEnv = ArtifactInvalidationEnv;

export type RevisionBytePurgeInput = {
  workspaceId: string;
  artifactId: string;
  revisionId: string;
  reason: BytePurgePayload["reason"];
};

export function revisionPurgePrefix(artifactId: string, revisionId: string): string {
  return `artifacts/${artifactId}/revisions/${revisionId}/`;
}

export async function writeRevisionDenylist(env: RevisionInvalidationEnv, revisionId: string): Promise<boolean> {
  if (!revisionId || !env.DENYLIST) {
    return false;
  }

  const value = JSON.stringify({ reason: "retention", at: new Date().toISOString() });
  for (let attempt = 1; attempt <= MAX_DENYLIST_ATTEMPTS; attempt += 1) {
    try {
      await env.DENYLIST.put(`rd:${revisionId}`, value, { expirationTtl: DENYLIST_EXPIRATION_TTL_SECONDS });
      return true;
    } catch {
      if (attempt === MAX_DENYLIST_ATTEMPTS) {
        return false;
      }
      await sleep(Math.min(250 * 2 ** (attempt - 1), 1000));
    }
  }
  return false;
}

export async function enqueueRevisionBytePurge(
  env: RevisionInvalidationEnv,
  executor: SqlExecutor,
  input: RevisionBytePurgeInput,
  hooks?: ArtifactBytePurgeHooks,
): Promise<boolean> {
  if (!env.BYTE_PURGE_QUEUE) {
    return false;
  }

  const message = BytePurgeMessage.parse({
    type: "byte.purge.v1",
    workspace_id: input.workspaceId,
    artifact_id: input.artifactId,
    revision_id: input.revisionId,
    upload_session_id: null,
    prefixes: [revisionPurgePrefix(input.artifactId, input.revisionId)],
    reason: input.reason,
  });

  try {
    await env.BYTE_PURGE_QUEUE.send(message);
    await hooks?.afterEnqueue?.(message);
  } catch {
    return false;
  }

  try {
    const result = await executor.query<{ id: string }>(
      `update revisions
       set bytes_purge_enqueued_at = now()
       where workspace_id = $1 and id = $2 and artifact_id = $3
       returning id`,
      [input.workspaceId, input.revisionId, input.artifactId],
    );
    if (result.rows.length === 0) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

export async function applyRevisionPurgeSideEffects(
  env: RevisionInvalidationEnv,
  executor: SqlExecutor,
  input: RevisionBytePurgeInput,
  hooks?: ArtifactBytePurgeHooks,
): Promise<{ denylistWritten: boolean; enqueued: boolean }> {
  const denylistWritten = await writeRevisionDenylist(env, input.revisionId);
  if (!denylistWritten) {
    return { denylistWritten: false, enqueued: false };
  }
  const enqueued = await enqueueRevisionBytePurge(env, executor, input, hooks);
  return { denylistWritten, enqueued };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
