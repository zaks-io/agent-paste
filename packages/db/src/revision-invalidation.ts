import type { BytePurgeMessage as BytePurgePayload } from "@agent-paste/contracts";
import {
  type ArtifactBytePurgeHooks,
  type ArtifactInvalidationEnv,
  enqueueBytePurge,
  writeDenylistKey,
} from "./byte-purge-shared.js";
import type { SqlExecutor } from "./types.js";
import { envScopedRevisionPrefix } from "./validation.js";

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

// Revision files live under artifact-scoped keys; the derived bundle lives
// under an env-scoped key (ADR 0021). Both must be purged.
export function revisionPurgePrefixes(env: RevisionInvalidationEnv, input: RevisionBytePurgeInput): string[] {
  return [
    revisionPurgePrefix(input.artifactId, input.revisionId),
    envScopedRevisionPrefix({
      workspaceId: input.workspaceId,
      artifactId: input.artifactId,
      revisionId: input.revisionId,
      storageEnv: env.AGENT_PASTE_ENV,
    }),
  ];
}

export function writeRevisionDenylist(env: RevisionInvalidationEnv, revisionId: string): Promise<boolean> {
  if (!revisionId) {
    return Promise.resolve(false);
  }
  return writeDenylistKey(env, `rd:${revisionId}`, "retention");
}

export function enqueueRevisionBytePurge(
  env: RevisionInvalidationEnv,
  executor: SqlExecutor,
  input: RevisionBytePurgeInput,
  hooks?: ArtifactBytePurgeHooks,
): Promise<boolean> {
  return enqueueBytePurge(
    env,
    executor,
    { ...input, uploadSessionId: null, prefixes: revisionPurgePrefixes(env, input) },
    hooks,
  );
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
