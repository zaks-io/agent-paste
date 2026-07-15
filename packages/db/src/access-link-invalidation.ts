import type { LockdownScope } from "@agent-paste/contracts";
import { isArtifactAccessLinkLocked } from "./access-links.js";
import { type ArtifactInvalidationEnv, deleteDenylistKey, writeDenylistKey } from "./byte-purge-shared.js";
import type { RepositoryCoreContext } from "./repository/core-context.js";
import { PLATFORM_SCOPE } from "./repository/core-helpers.js";

function platformLockdownDenylistKey(scope: LockdownScope, targetId: string): string {
  return scope === "workspace" ? `wsd:${targetId}` : `ad:${targetId}`;
}

/**
 * True when any control still requires `ad:{artifactId}`. The key is shared by
 * access-link lockdown and platform (artifact-scope) lockdown, so either lift
 * path must retain it while the other control is still active. Re-reads current
 * DB state so an idempotent replay of a lift (or a lift racing a concurrent
 * re-lock) cannot delete the key while a lockdown is in force.
 */
async function isArtifactDenylistKeyStillNeeded(ctx: RepositoryCoreContext, artifactId: string): Promise<boolean> {
  if (!artifactId) {
    return false;
  }
  return ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const artifact = await entities.artifacts.findById(artifactId);
    if (!artifact || artifact.deleted_at || artifact.status !== "active") {
      return true;
    }
    if (isArtifactAccessLinkLocked(artifact)) {
      return true;
    }
    const platformLockdown = await entities.platformLockdowns.findEffective("artifact", artifactId);
    return platformLockdown !== null;
  });
}

/** Retention peek for the access-link-lockdown lift path (see shared helper). */
export function peekArtifactDenylistRetention(ctx: RepositoryCoreContext, artifactId: string): Promise<boolean> {
  return isArtifactDenylistKeyStillNeeded(ctx, artifactId);
}

/** Retention peek for the platform-lockdown (artifact-scope) lift path (see shared helper). */
export function peekArtifactPlatformLockdownRetention(
  ctx: RepositoryCoreContext,
  artifactId: string,
): Promise<boolean> {
  return isArtifactDenylistKeyStillNeeded(ctx, artifactId);
}

/**
 * True when an effective workspace platform lockdown still requires
 * `wsd:{workspaceId}` — i.e. a replayed lift (or a lift racing a re-lock) must
 * not delete the denylist key.
 */
export async function peekWorkspacePlatformLockdownRetention(
  ctx: RepositoryCoreContext,
  workspaceId: string,
): Promise<boolean> {
  if (!workspaceId) {
    return false;
  }
  return ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const platformLockdown = await entities.platformLockdowns.findEffective("workspace", workspaceId);
    return platformLockdown !== null;
  });
}

export function writeAccessLinkRevocationDenylist(
  env: ArtifactInvalidationEnv,
  accessLinkId: string,
): Promise<boolean> {
  if (!accessLinkId) {
    return Promise.resolve(false);
  }
  return writeDenylistKey(env, `ald:${accessLinkId}`, "revocation");
}

export function writeAccessLinkLockdownDenylist(env: ArtifactInvalidationEnv, artifactId: string): Promise<boolean> {
  if (!artifactId) {
    return Promise.resolve(false);
  }
  return writeDenylistKey(env, `ad:${artifactId}`, "access_link_lockdown");
}

export function deleteAccessLinkLockdownDenylist(env: ArtifactInvalidationEnv, artifactId: string): Promise<boolean> {
  if (!artifactId) {
    return Promise.resolve(false);
  }
  return deleteDenylistKey(env, `ad:${artifactId}`);
}

export function writePlatformLockdownDenylist(
  env: ArtifactInvalidationEnv,
  scope: LockdownScope,
  targetId: string,
): Promise<boolean> {
  if (!targetId) {
    return Promise.resolve(false);
  }
  return writeDenylistKey(env, platformLockdownDenylistKey(scope, targetId), `platform_lockdown_${scope}`);
}

export function deletePlatformLockdownDenylist(
  env: ArtifactInvalidationEnv,
  scope: LockdownScope,
  targetId: string,
): Promise<boolean> {
  if (!targetId) {
    return Promise.resolve(false);
  }
  return deleteDenylistKey(env, platformLockdownDenylistKey(scope, targetId));
}
