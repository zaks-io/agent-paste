import type { LockdownScope } from "@agent-paste/contracts";
import {
  deleteAccessLinkLockdownDenylist,
  deletePlatformLockdownDenylist,
  type Repository,
  writeAccessLinkLockdownDenylist,
  writeAccessLinkRevocationDenylist,
  writePlatformLockdownDenylist,
} from "@agent-paste/db";
import type { Env } from "./env.js";
import { RepositoryRouteError } from "./responses.js";

function failIfDenylistSideEffectFailed(succeeded: boolean, env: Env, message: string): void {
  if (!succeeded && env.DENYLIST) {
    throw new RepositoryRouteError("storage_unavailable", message);
  }
}

export async function invalidateRevokedAccessLink(env: Env, accessLinkId: string): Promise<void> {
  if (!accessLinkId) {
    return;
  }
  const written = await writeAccessLinkRevocationDenylist(env, accessLinkId);
  failIfDenylistSideEffectFailed(written, env, `Denylist write failed for access link revocation ${accessLinkId}`);
}

export async function invalidateAccessLinkLockdown(env: Env, artifactId: string): Promise<void> {
  if (!artifactId) {
    return;
  }
  const written = await writeAccessLinkLockdownDenylist(env, artifactId);
  failIfDenylistSideEffectFailed(written, env, `Denylist write failed for access link lockdown ${artifactId}`);
}

export async function clearAccessLinkLockdownDenylist(env: Env, db: Repository, artifactId: string): Promise<void> {
  if (!artifactId) {
    return;
  }
  if (await db.peekArtifactDenylistRetention(artifactId)) {
    return;
  }
  const deleted = await deleteAccessLinkLockdownDenylist(env, artifactId);
  failIfDenylistSideEffectFailed(deleted, env, `Denylist delete failed for access link lockdown lift ${artifactId}`);
}

export async function invalidatePlatformLockdown(env: Env, scope: LockdownScope, targetId: string): Promise<void> {
  if (!targetId) {
    return;
  }
  const written = await writePlatformLockdownDenylist(env, scope, targetId);
  failIfDenylistSideEffectFailed(written, env, `Denylist write failed for ${scope} platform lockdown ${targetId}`);
}

export async function clearPlatformLockdownDenylist(env: Env, scope: LockdownScope, targetId: string): Promise<void> {
  if (!targetId) {
    return;
  }
  const deleted = await deletePlatformLockdownDenylist(env, scope, targetId);
  failIfDenylistSideEffectFailed(
    deleted,
    env,
    `Denylist delete failed for ${scope} platform lockdown lift ${targetId}`,
  );
}
