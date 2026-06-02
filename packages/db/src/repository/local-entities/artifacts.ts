import type { Artifact } from "../../types.js";
import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

function compareArtifactsForWeb(left: Artifact, right: Artifact) {
  const created = right.created_at.localeCompare(left.created_at);
  return created === 0 ? right.id.localeCompare(left.id) : created;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: entity method bag (147 lines), pending ratchet toward 60 — see docs/ops/complexity-todo.md
export function localArtifacts(state: LocalState): Entities["artifacts"] {
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
    async listExpiring(now, limit) {
      const nowMs = new Date(now).getTime();
      return [...state.artifacts.values()]
        .filter(
          (artifact) =>
            artifact.status === "active" && !artifact.pinned_at && new Date(artifact.expires_at).getTime() <= nowMs,
        )
        .sort((left, right) => left.expires_at.localeCompare(right.expires_at))
        .slice(0, limit)
        .map((artifact) => ({ id: artifact.id }));
    },
    async expireBatch(now, ids) {
      for (const id of ids) {
        const artifact = state.artifacts.get(id);
        if (artifact) {
          artifact.status = "expired";
          artifact.deleted_at = now;
          artifact.delete_reason = "expired";
          artifact.updated_at = now;
        }
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
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: known offender (39), pending ratchet toward 15 — see docs/ops/complexity-todo.md
    async reparentWorkspace(fromWorkspaceId, toWorkspaceId, minExpiresAt, updatedAt) {
      const artifactIds: string[] = [];
      for (const artifact of state.artifacts.values()) {
        if (artifact.workspace_id !== fromWorkspaceId) {
          continue;
        }
        artifactIds.push(artifact.id);
        artifact.workspace_id = toWorkspaceId;
        const currentExpiresAt = Date.parse(artifact.expires_at);
        const minExpiresAtMs = Date.parse(minExpiresAt);
        if (!Number.isNaN(currentExpiresAt) && !Number.isNaN(minExpiresAtMs) && minExpiresAtMs > currentExpiresAt) {
          artifact.expires_at = minExpiresAt;
        }
        artifact.updated_at = updatedAt;
      }
      for (const revision of state.revisions.values()) {
        if (revision.workspace_id === fromWorkspaceId) {
          revision.workspace_id = toWorkspaceId;
        }
      }
      for (const link of state.accessLinks.values()) {
        if (link.workspace_id === fromWorkspaceId) {
          link.workspace_id = toWorkspaceId;
        }
      }
      for (const warning of state.safetyWarnings.values()) {
        if (warning.workspace_id === fromWorkspaceId) {
          warning.workspace_id = toWorkspaceId;
        }
      }
      for (const session of state.uploadSessions.values()) {
        if (session.workspace_id === fromWorkspaceId) {
          session.workspace_id = toWorkspaceId;
        }
      }
      for (const file of state.uploadSessionFiles.values()) {
        if (file.workspace_id === fromWorkspaceId) {
          file.workspace_id = toWorkspaceId;
        }
      }
      for (const file of state.artifactFiles.values()) {
        if (file.workspace_id === fromWorkspaceId) {
          file.workspace_id = toWorkspaceId;
        }
      }
      return artifactIds;
    },
  };
}
