import type { BytePurgeMessage } from "@agent-paste/contracts";
import type { Env } from "./env.js";

export function smokeSyncBytePurgeEnabled(env: Env): boolean {
  if (env.SMOKE_SYNC_BYTE_PURGE === "true") {
    return true;
  }
  const value = env.AGENT_PASTE_ENV;
  return value !== undefined && value !== "production" && value !== "live";
}

export async function processSmokeSyncBytePurge(env: Env, message: BytePurgeMessage): Promise<number> {
  if (!smokeSyncBytePurgeEnabled(env)) {
    return 0;
  }
  if (!env.ARTIFACTS) {
    throw new Error("artifacts_bucket_missing");
  }

  const { deletePrefixes } = await import("./r2-purge.js");
  const deleted = await deletePrefixes(env.ARTIFACTS, message.prefixes);
  env.SYNC_BYTE_PURGE_DELETED_OBJECTS = (env.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0) + deleted;
  return deleted;
}
