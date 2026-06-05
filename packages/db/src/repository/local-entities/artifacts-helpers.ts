import type { Artifact } from "../../types.js";

export function compareArtifactsForWeb(left: Artifact, right: Artifact) {
  const created = right.created_at.localeCompare(left.created_at);
  return created === 0 ? right.id.localeCompare(left.id) : created;
}

export function bumpArtifactExpiresAt(artifact: Artifact, minExpiresAt: string) {
  const currentExpiresAt = Date.parse(artifact.expires_at);
  const minExpiresAtMs = Date.parse(minExpiresAt);
  if (!Number.isNaN(currentExpiresAt) && !Number.isNaN(minExpiresAtMs) && minExpiresAtMs > currentExpiresAt) {
    artifact.expires_at = minExpiresAt;
  }
}
