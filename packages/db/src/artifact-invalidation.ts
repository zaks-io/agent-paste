import type { BytePurgeMessage as BytePurgePayload } from "@agent-paste/contracts";
import {
  type ArtifactBytePurgeHooks,
  type ArtifactInvalidationEnv,
  enqueueBytePurge,
  writeDenylistKey,
} from "./byte-purge-shared.js";
import type { SqlExecutor } from "./types.js";

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
  return enqueueBytePurge(env, executor, { ...input, prefixes: [artifactPurgePrefix(input.artifactId)] }, hooks);
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
