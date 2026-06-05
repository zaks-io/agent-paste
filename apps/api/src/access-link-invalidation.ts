import {
  deleteAccessLinkLockdownDenylist,
  writeAccessLinkLockdownDenylist,
  writeAccessLinkRevocationDenylist,
} from "@agent-paste/db";
import type { Env } from "./env.js";

export async function invalidateRevokedAccessLink(env: Env, accessLinkId: string): Promise<void> {
  const written = await writeAccessLinkRevocationDenylist(env, accessLinkId);
  if (!written && accessLinkId && env.DENYLIST) {
    console.warn(`Denylist write failed for access link revocation ${accessLinkId}; revoke persisted.`);
  }
}

export async function invalidateAccessLinkLockdown(env: Env, artifactId: string): Promise<void> {
  const written = await writeAccessLinkLockdownDenylist(env, artifactId);
  if (!written && artifactId && env.DENYLIST) {
    console.warn(`Denylist write failed for access link lockdown ${artifactId}; lockdown persisted.`);
  }
}

export async function clearAccessLinkLockdownDenylist(env: Env, artifactId: string): Promise<void> {
  const deleted = await deleteAccessLinkLockdownDenylist(env, artifactId);
  if (!deleted && artifactId && env.DENYLIST) {
    console.warn(`Denylist delete failed for access link lockdown lift ${artifactId}; lockdown lifted.`);
  }
}
