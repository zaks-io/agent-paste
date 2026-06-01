import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localRevisions(state: LocalState): Entities["revisions"] {
  return {
    async insert(revision) {
      state.revisions.set(revision.id, revision);
    },
    async findById(revisionId, workspaceId) {
      const revision = state.revisions.get(revisionId);
      if (!revision || (workspaceId && revision.workspace_id !== workspaceId)) {
        return null;
      }
      return revision;
    },
    async findDraftForArtifact(artifactId) {
      return (
        [...state.revisions.values()].find(
          (revision) => revision.artifact_id === artifactId && revision.status === "draft",
        ) ?? null
      );
    },
    async listForArtifact(artifactId) {
      return [...state.revisions.values()]
        .filter((revision) => revision.artifact_id === artifactId)
        .sort((left, right) => {
          const leftNumber = left.revision_number;
          const rightNumber = right.revision_number;
          if (leftNumber === null && rightNumber !== null) {
            return 1;
          }
          if (rightNumber === null && leftNumber !== null) {
            return -1;
          }
          if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
            return rightNumber - leftNumber;
          }
          return right.created_at.localeCompare(left.created_at);
        });
    },
    async nextRevisionNumber(artifactId) {
      const published = [...state.revisions.values()].filter(
        (revision) => revision.artifact_id === artifactId && revision.status === "published",
      );
      const max = published.reduce((current, revision) => Math.max(current, revision.revision_number ?? 0), 0);
      return max + 1;
    },
    async publish(input) {
      const revision = state.revisions.get(input.revisionId);
      if (!revision || revision.status !== "draft") {
        return false;
      }
      revision.status = "published";
      revision.revision_number = input.revisionNumber;
      revision.published_at = input.publishedAt;
      revision.bundle_status = input.bundleStatus;
      revision.bundle_status_updated_at = input.publishedAt;
      revision.bundle_size_bytes = null;
      return true;
    },
    async markRetained(input) {
      const revision = state.revisions.get(input.revisionId);
      if (
        !revision ||
        revision.workspace_id !== input.workspaceId ||
        revision.artifact_id !== input.artifactId ||
        revision.status !== "published"
      ) {
        return false;
      }
      revision.status = "retained";
      return true;
    },
  };
}
