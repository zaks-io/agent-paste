import { writeArtifactDenylist as writeArtifactDenylistCore } from "@agent-paste/db";
import type { Env } from "../env.js";
import { logOpError } from "../op-log.js";

export async function writeArtifactDenylist(env: Env, artifactId: string): Promise<boolean> {
  const written = await writeArtifactDenylistCore(env, artifactId);
  if (!written && artifactId && env.DENYLIST) {
    logOpError("lifecycle.denylist.failed", { artifact_id: artifactId });
  }
  return written;
}
