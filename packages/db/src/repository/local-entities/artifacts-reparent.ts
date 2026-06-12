import { remapWorkspaceBlobR2Key } from "../../queries/reparent-blobs.js";
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

function reparentBlobFiles<T extends { workspace_id: string; storage_kind?: string; r2_key: string }>(
  entries: Iterable<T>,
  fromWorkspaceId: string,
  toWorkspaceId: string,
) {
  for (const entry of entries) {
    if (entry.workspace_id !== fromWorkspaceId) {
      continue;
    }
    entry.workspace_id = toWorkspaceId;
    if (entry.storage_kind === "blob") {
      entry.r2_key = remapWorkspaceBlobR2Key(entry.r2_key, fromWorkspaceId, toWorkspaceId);
    }
  }
}

function upsertReparentedContentBlobs(state: LocalState, workspaceId: string, updatedAt: string) {
  const seen = new Set<string>();
  for (const file of state.artifactFiles.values()) {
    if (file.workspace_id !== workspaceId || file.storage_kind !== "blob" || !file.sha256) {
      continue;
    }
    const dedupeKey = `${file.sha256}:${file.size_bytes}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    const key = `${workspaceId}:${file.sha256}:${file.size_bytes}`;
    state.contentBlobs.set(key, {
      workspace_id: workspaceId,
      sha256: file.sha256,
      size_bytes: file.size_bytes,
      r2_key: file.r2_key,
      created_at: updatedAt,
      updated_at: updatedAt,
    });
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
      reparentBlobFiles(state.uploadSessionFiles.values(), fromWorkspaceId, toWorkspaceId);
      reparentBlobFiles(state.artifactFiles.values(), fromWorkspaceId, toWorkspaceId);
      upsertReparentedContentBlobs(state, toWorkspaceId, updatedAt);
      return artifactIds;
    },
  };
}
