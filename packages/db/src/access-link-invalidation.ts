import { type ArtifactInvalidationEnv, deleteDenylistKey, writeDenylistKey } from "./byte-purge-shared.js";

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
