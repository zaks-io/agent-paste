import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";
import { compareArtifactsForWeb } from "./artifacts-helpers.js";

export function localArtifactReadMethods(
  state: LocalState,
): Pick<Entities["artifacts"], "insert" | "findById" | "listFiltered" | "listWebPage"> {
  return {
    async insert(artifact) {
      state.artifacts.set(artifact.id, artifact);
    },
    async findById(artifactId, workspaceId) {
      const artifact = state.artifacts.get(artifactId);
      if (!artifact || (workspaceId && artifact.workspace_id !== workspaceId)) {
        return null;
      }
      return artifact;
    },
    async listFiltered(workspaceId, status) {
      return [...state.artifacts.values()]
        .filter((artifact) => (workspaceId ? artifact.workspace_id === workspaceId : true))
        .filter((artifact) => (status ? artifact.status === status : true));
    },
    async listWebPage(input) {
      const cursorCreatedAt = input.cursor ? input.cursor.createdAt.toISOString() : null;
      const cursorId = input.cursor?.id ?? null;
      return [...state.artifacts.values()]
        .filter((artifact) => artifact.workspace_id === input.workspaceId)
        .filter(
          (artifact) =>
            cursorCreatedAt === null ||
            cursorId === null ||
            artifact.created_at < cursorCreatedAt ||
            (artifact.created_at === cursorCreatedAt && artifact.id < cursorId),
        )
        .sort(compareArtifactsForWeb)
        .slice(0, input.limit);
    },
  };
}
