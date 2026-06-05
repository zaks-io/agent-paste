import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

export function localArtifactPinMethods(
  state: LocalState,
): Pick<Entities["artifacts"], "countPinned" | "tryPinUnderCap" | "setPinnedAt"> {
  return {
    async countPinned(workspaceId) {
      return [...state.artifacts.values()].filter(
        (artifact) => artifact.workspace_id === workspaceId && artifact.status === "active" && artifact.pinned_at,
      ).length;
    },
    async tryPinUnderCap(workspaceId, artifactId, pinnedAt, updatedAt, cap) {
      const artifact = state.artifacts.get(artifactId);
      if (!artifact || artifact.workspace_id !== workspaceId || artifact.status !== "active" || !artifact.revision_id) {
        return "not_found";
      }
      if (artifact.pinned_at) {
        return "pinned";
      }
      const pinnedCount = [...state.artifacts.values()].filter(
        (entry) => entry.workspace_id === workspaceId && entry.status === "active" && entry.pinned_at,
      ).length;
      if (pinnedCount >= cap) {
        return "cap_exceeded";
      }
      artifact.pinned_at = pinnedAt;
      artifact.updated_at = updatedAt;
      return "pinned";
    },
    async setPinnedAt(artifactId, pinnedAt, updatedAt) {
      const artifact = state.artifacts.get(artifactId);
      if (!artifact) {
        return false;
      }
      artifact.pinned_at = pinnedAt;
      artifact.updated_at = updatedAt;
      return true;
    },
  };
}
