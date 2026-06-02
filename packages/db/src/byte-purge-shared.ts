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

// Writes a denylist entry with bounded exponential-backoff retries. Callers
// supply the fully-qualified KV key (e.g. `ad:<id>` / `rd:<id>`) and reason.
export async function writeDenylistKey(env: ArtifactInvalidationEnv, key: string, reason: string): Promise<boolean> {
  if (!env.DENYLIST) {
    return false;
  }

  const value = JSON.stringify({ reason, at: new Date().toISOString() });
  for (let attempt = 1; attempt <= MAX_DENYLIST_ATTEMPTS; attempt += 1) {
    try {
      await env.DENYLIST.put(key, value, { expirationTtl: DENYLIST_EXPIRATION_TTL_SECONDS });
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

export type BytePurgeEnqueueInput = {
  workspaceId: string;
  artifactId: string;
  revisionId: string;
  reason: BytePurgePayload["reason"];
  prefixes: string[];
  uploadSessionId?: string | null;
};

// Enqueues a byte-purge message and records bytes_purge_enqueued_at outside
// runCommand (ADR 0049). Returns false on send failure or a no-op update.
export async function enqueueBytePurge(
  env: ArtifactInvalidationEnv,
  executor: SqlExecutor,
  input: BytePurgeEnqueueInput,
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
    prefixes: input.prefixes,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
