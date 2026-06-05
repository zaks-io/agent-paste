import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";
import { bumpArtifactExpiresAt } from "./artifacts-helpers.js";

function reparentArtifacts(
  state: LocalState,
  fromWorkspaceId: string,
  toWorkspaceId: string,
  minExpiresAt: string,
  updatedAt: string,
) {
  const artifactIds: string[] = [];
  for (const artifact of state.artifacts.values()) {
    if (artifact.workspace_id !== fromWorkspaceId) {
      continue;
    }
    artifactIds.push(artifact.id);
    artifact.workspace_id = toWorkspaceId;
    bumpArtifactExpiresAt(artifact, minExpiresAt);
    artifact.updated_at = updatedAt;
  }
  return artifactIds;
}

function reparentWorkspaceId<T extends { workspace_id: string }>(
  entries: Iterable<T>,
  fromWorkspaceId: string,
  toWorkspaceId: string,
) {
  for (const entry of entries) {
    if (entry.workspace_id === fromWorkspaceId) {
      entry.workspace_id = toWorkspaceId;
    }
  }
}

export function localArtifactReparentMethods(state: LocalState): Pick<Entities["artifacts"], "reparentWorkspace"> {
  return {
    async reparentWorkspace(fromWorkspaceId, toWorkspaceId, minExpiresAt, updatedAt) {
      const artifactIds = reparentArtifacts(state, fromWorkspaceId, toWorkspaceId, minExpiresAt, updatedAt);
      reparentWorkspaceId(state.revisions.values(), fromWorkspaceId, toWorkspaceId);
      reparentWorkspaceId(state.accessLinks.values(), fromWorkspaceId, toWorkspaceId);
      reparentWorkspaceId(state.safetyWarnings.values(), fromWorkspaceId, toWorkspaceId);
      reparentWorkspaceId(state.uploadSessions.values(), fromWorkspaceId, toWorkspaceId);
      reparentWorkspaceId(state.uploadSessionFiles.values(), fromWorkspaceId, toWorkspaceId);
      reparentWorkspaceId(state.artifactFiles.values(), fromWorkspaceId, toWorkspaceId);
      return artifactIds;
    },
  };
}
