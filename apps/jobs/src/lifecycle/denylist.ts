import { USAGE_POLICY as usagePolicy } from "@agent-paste/config";
import type { Env } from "../env.js";
import { logOpError } from "../op-log.js";

const DENYLIST_EXPIRATION_TTL_SECONDS = usagePolicy.max_ttl_seconds;
const MAX_ATTEMPTS = 3;

export async function writeArtifactDenylist(env: Env, artifactId: string): Promise<boolean> {
  if (!artifactId || !env.DENYLIST) {
    return false;
  }

  const value = JSON.stringify({ reason: "deletion", at: new Date().toISOString() });
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await env.DENYLIST.put(`ad:${artifactId}`, value, { expirationTtl: DENYLIST_EXPIRATION_TTL_SECONDS });
      return true;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        logOpError("lifecycle.denylist.failed", {
          artifact_id: artifactId,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
      await sleep(Math.min(250 * 2 ** (attempt - 1), 1000));
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
