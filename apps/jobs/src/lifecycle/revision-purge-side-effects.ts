import type { BytePurgeMessage } from "@agent-paste/contracts";
import type { SqlExecutor } from "@agent-paste/db";
import type { Env } from "../env.js";
import { enqueueRevisionBytePurge } from "./revision-byte-purge-enqueue.js";
import { writeRevisionDenylist } from "./revision-denylist.js";

export async function applyRevisionPurgeSideEffects(
  env: Env,
  executor: SqlExecutor,
  input: {
    workspaceId: string;
    artifactId: string;
    revisionId: string;
    reason: BytePurgeMessage["reason"];
  },
): Promise<{ denylistWritten: boolean; enqueued: boolean }> {
  const denylistWritten = await writeRevisionDenylist(env, input.revisionId);
  if (!denylistWritten) {
    return { denylistWritten: false, enqueued: false };
  }
  const enqueued = await enqueueRevisionBytePurge(env, executor, input);
  return { denylistWritten, enqueued };
}
