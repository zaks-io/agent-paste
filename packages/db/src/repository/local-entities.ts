import { createId } from "../id.js";
import type { Artifact, OperationEvent, PlatformLockdown } from "../types.js";
import type { LocalState } from "./local-state.js";
import type { Entities } from "./ports.js";

function compareArtifactsForWeb(left: Artifact, right: Artifact) {
  const created = right.created_at.localeCompare(left.created_at);
  return created === 0 ? right.id.localeCompare(left.id) : created;
}

function compareOperationEventsForWeb(left: OperationEvent, right: OperationEvent) {
  const occurred = right.occurred_at.localeCompare(left.occurred_at);
  return occurred === 0 ? right.id.localeCompare(left.id) : occurred;
}

// Build the grouped Entities accessor over the in-memory Maps. The local backend has
// no transactions, so reads and writes apply directly; cursor comparison canonicalizes
// the cursor Date back to an ISO string to match stored created_at values exactly.
export function localEntities(state: LocalState): Entities {
  const filesForSession = (sessionId: string) =>
    [...state.uploadSessionFiles.values()].filter((file) => file.upload_session_id === sessionId);

  return {
    workspaces: {
      async insert(workspace) {
        state.workspaces.set(workspace.id, workspace);
      },
      async findById(id) {
        return state.workspaces.get(id) ?? null;
      },
      async listAll() {
        return [...state.workspaces.values()].sort((left, right) => right.created_at.localeCompare(left.created_at));
      },
      async update(id, input) {
        const workspace = state.workspaces.get(id);
        if (workspace) {
          workspace.name = input.name;
          workspace.auto_deletion_days = input.autoDeletionDays;
          workspace.updated_at = input.updatedAt;
        }
      },
    },
    apiKeys: {
      async insert(apiKey) {
        state.apiKeys.set(apiKey.id, apiKey);
      },
      async findById(id) {
        return state.apiKeys.get(id) ?? null;
      },
      async findByPublicId(publicId) {
        return [...state.apiKeys.values()].find((apiKey) => apiKey.public_id === publicId) ?? null;
      },
      async listForWorkspace(workspaceId) {
        return [...state.apiKeys.values()]
          .filter((apiKey) => apiKey.workspace_id === workspaceId)
          .sort((left, right) => right.created_at.localeCompare(left.created_at));
      },
      async updateLastUsedAt(id, lastUsedAt) {
        const apiKey = state.apiKeys.get(id);
        if (apiKey) {
          apiKey.last_used_at = lastUsedAt;
        }
      },
      async updateRevokedAt(id, revokedAt) {
        const apiKey = state.apiKeys.get(id);
        if (apiKey) {
          apiKey.revoked_at = revokedAt;
        }
      },
    },
    members: {
      async insert(member) {
        state.workspaceMembers.set(member.id, member);
      },
      async findById(id) {
        return state.workspaceMembers.get(id) ?? null;
      },
      async findByWorkOsUserId(workosUserId) {
        return [...state.workspaceMembers.values()].find((member) => member.workos_user_id === workosUserId) ?? null;
      },
      async updateSeen(id, input) {
        const member = state.workspaceMembers.get(id);
        if (!member) {
          return null;
        }
        member.email = input.email;
        member.last_seen_at = input.lastSeenAt;
        return member;
      },
    },
    artifacts: {
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
      async markDeleted(artifactId, deletedAt) {
        const artifact = state.artifacts.get(artifactId);
        if (artifact) {
          artifact.status = "deleted";
          artifact.deleted_at = deletedAt;
          artifact.delete_reason = "admin_delete";
          artifact.updated_at = deletedAt;
        }
      },
      async listExpiring(now, limit) {
        const nowMs = new Date(now).getTime();
        return [...state.artifacts.values()]
          .filter((artifact) => artifact.status === "active" && new Date(artifact.expires_at).getTime() <= nowMs)
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
    },
    artifactFiles: {
      async insert(artifactId, revisionId, file, fallbackUploadedAt) {
        state.artifactFiles.set(`${artifactId}:${file.path}`, {
          ...file,
          artifact_id: artifactId,
          revision_id: revisionId,
          uploaded_at: file.uploaded_at ?? fallbackUploadedAt,
        });
      },
      async listForArtifact(artifactId) {
        return [...state.artifactFiles.values()].filter((file) => file.artifact_id === artifactId);
      },
    },
    uploadSessions: {
      async insert(session) {
        state.uploadSessions.set(session.id, session);
      },
      async findById(sessionId, workspaceId) {
        const session = state.uploadSessions.get(sessionId);
        if (!session || (workspaceId && session.workspace_id !== workspaceId)) {
          return null;
        }
        return session;
      },
      async markFinalized(sessionId, finalizedAt) {
        const session = state.uploadSessions.get(sessionId);
        if (session) {
          session.status = "finalized";
          session.finalized_at = finalizedAt;
        }
      },
      async listExpiring(now, limit) {
        const nowMs = new Date(now).getTime();
        return [...state.uploadSessions.values()]
          .filter((session) => session.status === "pending" && new Date(session.expires_at).getTime() <= nowMs)
          .sort((left, right) => left.expires_at.localeCompare(right.expires_at))
          .slice(0, limit)
          .map((session) => ({ id: session.id }));
      },
      async expireBatch(_now, ids) {
        for (const id of ids) {
          const session = state.uploadSessions.get(id);
          if (session) {
            session.status = "expired";
          }
        }
      },
    },
    uploadSessionFiles: {
      async insert(sessionId, file) {
        state.uploadSessionFiles.set(`${sessionId}:${file.path}`, file);
      },
      async listForSession(sessionId) {
        return filesForSession(sessionId);
      },
      async recordUpload(input) {
        const file = state.uploadSessionFiles.get(`${input.sessionId}:${input.path}`);
        if (file) {
          file.uploaded_at = input.uploadedAt;
        }
      },
    },
    platformLockdowns: {
      async findEffective(scope, targetId) {
        return (
          [...state.platformLockdowns.values()].find(
            (lockdown) => lockdown.scope === scope && lockdown.target_id === targetId && lockdown.lifted_at === null,
          ) ?? null
        );
      },
      async insert(lockdown: PlatformLockdown) {
        state.platformLockdowns.set(lockdown.id, lockdown);
      },
      async markLifted(id, input) {
        const lockdown = state.platformLockdowns.get(id);
        if (lockdown) {
          lockdown.lifted_at = input.liftedAt;
          lockdown.lifted_by = input.liftedBy;
        }
      },
    },
    operationEvents: {
      async insert(input) {
        const event: OperationEvent = {
          id: createId("evt"),
          workspace_id: input.workspaceId,
          actor_type: input.actorType,
          actor_id: input.actorId,
          action: input.action,
          target_type: input.targetType,
          target_id: input.targetId,
          details: input.details,
          request_id: null,
          occurred_at: input.occurredAt,
        };
        state.operationEvents.set(event.id, event);
      },
      async listAll() {
        return [...state.operationEvents.values()].sort((left, right) =>
          right.occurred_at.localeCompare(left.occurred_at),
        );
      },
      async listForWorkspace(workspaceId) {
        return [...state.operationEvents.values()]
          .filter((event) => event.workspace_id === workspaceId)
          .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
      },
      async listWebPage(input) {
        const cursorOccurredAt = input.cursor ? input.cursor.occurredAt.toISOString() : null;
        const cursorId = input.cursor?.id ?? null;
        return [...state.operationEvents.values()]
          .filter((event) => event.workspace_id === input.workspaceId)
          .filter(
            (event) =>
              cursorOccurredAt === null ||
              cursorId === null ||
              event.occurred_at < cursorOccurredAt ||
              (event.occurred_at === cursorOccurredAt && event.id < cursorId),
          )
          .sort(compareOperationEventsForWeb)
          .slice(0, input.limit);
      },
      async listIdsForTarget(targetId) {
        return [...state.operationEvents.values()]
          .filter((event) => event.target_id === targetId)
          .map((event) => event.id);
      },
    },
  };
}
