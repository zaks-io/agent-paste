import { writeRevisionDenylist as writeRevisionDenylistCore } from "@agent-paste/db";
import type { Env } from "../env.js";
import { logOpError } from "../op-log.js";

export async function writeRevisionDenylist(env: Env, revisionId: string): Promise<boolean> {
  const written = await writeRevisionDenylistCore(env, revisionId);
  if (!written && revisionId && env.DENYLIST) {
    logOpError("lifecycle.revision_denylist.failed", { revision_id: revisionId });
  }
  return written;
}
