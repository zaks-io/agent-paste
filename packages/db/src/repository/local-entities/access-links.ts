import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localAccessLinks(state: LocalState): Entities["accessLinks"] {
  return {
    async insert(link) {
      state.accessLinks.set(link.id, link);
    },
    async findById(id, workspaceId) {
      const link = state.accessLinks.get(id);
      if (!link || (workspaceId && link.workspace_id !== workspaceId)) {
        return null;
      }
      return link;
    },
    async findByPublicId(publicId) {
      return [...state.accessLinks.values()].find((link) => link.public_id === publicId) ?? null;
    },
    async listForArtifact(artifactId) {
      return [...state.accessLinks.values()]
        .filter((link) => link.artifact_id === artifactId)
        .sort((left, right) => right.created_at.localeCompare(left.created_at));
    },
    async revoke(id, revokedAt) {
      const link = state.accessLinks.get(id);
      if (!link || link.revoked_at) {
        return false;
      }
      link.revoked_at = revokedAt;
      return true;
    },
    async updateExpiresAt(id, expiresAt) {
      const link = state.accessLinks.get(id);
      if (!link) {
        return false;
      }
      link.expires_at = expiresAt;
      return true;
    },
  };
}
