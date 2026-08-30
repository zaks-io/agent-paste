import type { LockdownScope } from "@agent-paste/contracts";
import { deletePlatformLockdownDenylist, type Repository, writePlatformLockdownDenylist } from "@agent-paste/db";
import type { Env } from "./env.js";
import { RepositoryRouteError } from "./responses.js";

function failIfDenylistSideEffectFailed(succeeded: boolean, env: Env, message: string): void {
  if (!succeeded && env.DENYLIST) {
    throw new RepositoryRouteError("storage_unavailable", message);
  }
}

export async function invalidatePlatformLockdown(env: Env, scope: LockdownScope, targetId: string): Promise<void> {
  if (!targetId) return;
  const written = await writePlatformLockdownDenylist(env, scope, targetId);
  failIfDenylistSideEffectFailed(written, env, `Denylist write failed for ${scope} platform lockdown ${targetId}`);
}

export async function clearPlatformLockdownDenylist(
  env: Env,
  db: Repository,
  scope: LockdownScope,
  targetId: string,
): Promise<void> {
  if (!targetId) return;
  if (scope === "artifact" && (await db.peekArtifactPlatformLockdownRetention(targetId))) return;
  if (scope === "workspace" && (await db.peekWorkspacePlatformLockdownRetention(targetId))) return;

  const deleted = await deletePlatformLockdownDenylist(env, scope, targetId);
  failIfDenylistSideEffectFailed(
    deleted,
    env,
    `Denylist delete failed for ${scope} platform lockdown lift ${targetId}`,
  );
}
