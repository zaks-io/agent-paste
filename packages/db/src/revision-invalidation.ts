import type { BytePurgeMessage as BytePurgePayload } from "@agent-paste/contracts";
import {
  type ArtifactBytePurgeHooks,
  type ArtifactInvalidationEnv,
  enqueueBytePurge,
  writeDenylistKey,
} from "./byte-purge-shared.js";
import type { SqlExecutor } from "./types.js";

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
    { ...input, uploadSessionId: null, prefixes: [revisionPurgePrefix(input.artifactId, input.revisionId)] },
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
