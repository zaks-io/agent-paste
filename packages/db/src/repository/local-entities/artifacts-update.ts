import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localArtifactUpdateMethods(
  state: LocalState,
): Pick<
  Entities["artifacts"],
  "updateExpiry" | "updatePublished" | "updateTitle" | "updateStaging" | "markDeleted" | "setAccessLinkLockdown"
> {
  return {
    async updateExpiry(artifactId, expiresAt) {
      const artifact = state.artifacts.get(artifactId);
      if (!artifact) {
        return null;
      }
      artifact.expires_at = expiresAt;
      artifact.updated_at = new Date().toISOString();
      return { artifact_id: artifact.id, expires_at: artifact.expires_at };
    },
    async updatePublished(artifactId, input) {
      const artifact = state.artifacts.get(artifactId);
      if (artifact) {
        artifact.revision_id = input.revisionId;
        artifact.title = input.title;
        artifact.entrypoint = input.entrypoint;
        artifact.file_count = input.fileCount;
        artifact.size_bytes = input.sizeBytes;
        artifact.expires_at = input.expiresAt;
        artifact.updated_at = input.updatedAt;
      }
    },
    async updateTitle(artifactId, workspaceId, title, updatedAt) {
      const artifact = state.artifacts.get(artifactId);
      if (!artifact || artifact.workspace_id !== workspaceId) {
        return false;
      }
      artifact.title = title;
      artifact.updated_at = updatedAt;
      return true;
    },
    async updateStaging(artifactId, input) {
      const artifact = state.artifacts.get(artifactId);
      if (artifact) {
        artifact.title = input.title;
        artifact.entrypoint = input.entrypoint;
        artifact.file_count = input.fileCount;
        artifact.size_bytes = input.sizeBytes;
        artifact.expires_at = input.expiresAt;
        artifact.updated_at = input.updatedAt;
      }
    },
    async markDeleted(artifactId, deletedAt) {
      const artifact = state.artifacts.get(artifactId);
      if (artifact) {
        artifact.status = "deleted";
        artifact.deleted_at = deletedAt;
        artifact.delete_reason = "admin_delete";
        artifact.updated_at = deletedAt;
      }
    },
    async setAccessLinkLockdown(artifactId, lockdownAt) {
      const artifact = state.artifacts.get(artifactId);
      if (!artifact) {
        return false;
      }
      artifact.access_link_lockdown_at = lockdownAt;
      artifact.updated_at = new Date().toISOString();
      return true;
    },
  };
}
