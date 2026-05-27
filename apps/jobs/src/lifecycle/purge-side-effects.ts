import type { BytePurgeMessage } from "@agent-paste/contracts";
import type { SqlExecutor } from "@agent-paste/db";
import type { Env } from "../env.js";
import { enqueueArtifactBytePurge } from "./byte-purge-enqueue.js";
import { writeArtifactDenylist } from "./denylist.js";

export async function applyArtifactPurgeSideEffects(
  env: Env,
  executor: SqlExecutor,
  input: {
    workspaceId: string;
    artifactId: string;
    revisionId: string;
    reason: BytePurgeMessage["reason"];
    uploadSessionId?: string | null;
  },
): Promise<{ denylistWritten: boolean; enqueued: boolean }> {
  const denylistWritten = await writeArtifactDenylist(env, input.artifactId);
  if (!denylistWritten) {
    return { denylistWritten: false, enqueued: false };
  }
  const enqueued = await enqueueArtifactBytePurge(env, executor, input);
  return { denylistWritten, enqueued };
}
