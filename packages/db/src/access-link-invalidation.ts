import { type ArtifactInvalidationEnv, deleteDenylistKey, writeDenylistKey } from "./byte-purge-shared.js";
import type { RepositoryCoreContext } from "./repository/core-context.js";
import { PLATFORM_SCOPE } from "./repository/core-helpers.js";

/** True when another control still requires `ad:{artifactId}` after access-link lockdown lift. */
export async function peekArtifactDenylistRetention(
  ctx: RepositoryCoreContext,
  artifactId: string,
): Promise<boolean> {
  if (!artifactId) {
    return false;
  }
  return ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const artifact = await entities.artifacts.findById(artifactId);
    if (!artifact || artifact.deleted_at || artifact.status !== "active") {
      return true;
    }
    const platformLockdown = await entities.platformLockdowns.findEffective("artifact", artifactId);
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

export function writeAccessLinkLockdownDenylist(
  env: ArtifactInvalidationEnv,
  artifactId: string,
): Promise<boolean> {
  if (!artifactId) {
    return Promise.resolve(false);
  }
  return writeDenylistKey(env, `ad:${artifactId}`, "access_link_lockdown");
}

export function deleteAccessLinkLockdownDenylist(
  env: ArtifactInvalidationEnv,
  artifactId: string,
): Promise<boolean> {
  if (!artifactId) {
    return Promise.resolve(false);
  }
  return deleteDenylistKey(env, `ad:${artifactId}`);
}
