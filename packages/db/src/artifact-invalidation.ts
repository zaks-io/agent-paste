import { resolveUsagePolicy } from "@agent-paste/config";
import { BytePurgeMessage, type BytePurgeMessage as BytePurgePayload } from "@agent-paste/contracts";
import type { SqlExecutor } from "./types.js";

const DENYLIST_EXPIRATION_TTL_SECONDS = resolveUsagePolicy({ billingEnabled: false }).max_ttl_seconds;
const MAX_DENYLIST_ATTEMPTS = 3;

export type DenylistBinding = {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export type BytePurgeQueueBinding = {
  send(message: unknown): Promise<unknown>;
};

export type ArtifactInvalidationEnv = {
  DENYLIST?: DenylistBinding;
  BYTE_PURGE_QUEUE?: BytePurgeQueueBinding;
};

export type ArtifactBytePurgeHooks = {
  afterEnqueue?: (message: BytePurgePayload) => Promise<void>;
};

export type ArtifactBytePurgeInput = {
  workspaceId: string;
  artifactId: string;
  revisionId: string;
  reason: BytePurgePayload["reason"];
  uploadSessionId?: string | null;
};

export function artifactPurgePrefix(artifactId: string): string {
  return `artifacts/${artifactId}/`;
}

export async function writeArtifactDenylist(
  env: ArtifactInvalidationEnv,
  artifactId: string,
  options?: { reason?: string },
): Promise<boolean> {
  if (!artifactId || !env.DENYLIST) {
    return false;
  }

  const value = JSON.stringify({ reason: options?.reason ?? "deletion", at: new Date().toISOString() });
  for (let attempt = 1; attempt <= MAX_DENYLIST_ATTEMPTS; attempt += 1) {
    try {
      await env.DENYLIST.put(`ad:${artifactId}`, value, { expirationTtl: DENYLIST_EXPIRATION_TTL_SECONDS });
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

export async function enqueueArtifactBytePurge(
  env: ArtifactInvalidationEnv,
  executor: SqlExecutor,
  input: ArtifactBytePurgeInput,
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
    upload_session_id: input.uploadSessionId ?? null,
    prefixes: [artifactPurgePrefix(input.artifactId)],
    reason: input.reason,
  });

  try {
    await env.BYTE_PURGE_QUEUE.send(message);
    await hooks?.afterEnqueue?.(message);
  } catch {
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
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

/** Post-commit invalidation: denylist first, then byte-purge enqueue (ADR 0049). */
export async function applyArtifactPurgeSideEffects(
  env: ArtifactInvalidationEnv,
  executor: SqlExecutor,
  input: ArtifactBytePurgeInput,
  hooks?: ArtifactBytePurgeHooks,
): Promise<{ denylistWritten: boolean; enqueued: boolean }> {
  const denylistWritten = await writeArtifactDenylist(env, input.artifactId);
  if (!denylistWritten) {
    return { denylistWritten: false, enqueued: false };
  }
  const enqueued = await enqueueArtifactBytePurge(env, executor, input, hooks);
  return { denylistWritten, enqueued };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
