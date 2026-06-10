import type { BytePurgeMessage as BytePurgePayload } from "@agent-paste/contracts";
import {
  type ArtifactBytePurgeHooks,
  type ArtifactInvalidationEnv,
  enqueueBytePurge,
  writeDenylistKey,
} from "./byte-purge-shared.js";
import type { SqlExecutor } from "./types.js";
import { envScopedArtifactPrefix } from "./validation.js";

export type {
  ArtifactBytePurgeHooks,
  ArtifactInvalidationEnv,
  BytePurgeQueueBinding,
  DenylistBinding,
} from "./byte-purge-shared.js";

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

// Revision files live under artifact-scoped keys; derived bundles live under
// env-scoped keys (ADR 0021). Both must be purged or bundle zips orphan in R2.
export function artifactPurgePrefixes(env: ArtifactInvalidationEnv, workspaceId: string, artifactId: string): string[] {
  return [
    artifactPurgePrefix(artifactId),
    envScopedArtifactPrefix({ workspaceId, artifactId, storageEnv: env.AGENT_PASTE_ENV }),
  ];
}

export function writeArtifactDenylist(
  env: ArtifactInvalidationEnv,
  artifactId: string,
  options?: { reason?: string },
): Promise<boolean> {
  if (!artifactId) {
    return Promise.resolve(false);
  }
  return writeDenylistKey(env, `ad:${artifactId}`, options?.reason ?? "deletion");
}

export function enqueueArtifactBytePurge(
  env: ArtifactInvalidationEnv,
  executor: SqlExecutor,
  input: ArtifactBytePurgeInput,
  hooks?: ArtifactBytePurgeHooks,
): Promise<boolean> {
  return enqueueBytePurge(
    env,
    executor,
    { ...input, prefixes: artifactPurgePrefixes(env, input.workspaceId, input.artifactId) },
    hooks,
  );
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
