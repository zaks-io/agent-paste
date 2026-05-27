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

function compareLockdownsForWeb(left: PlatformLockdown, right: PlatformLockdown) {
  const setAt = right.set_at.localeCompare(left.set_at);
  return setAt === 0 ? right.id.localeCompare(left.id) : setAt;
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
              artifact.status === "active" &&
              !artifact.pinned_at &&
              new Date(artifact.expires_at).getTime() <= nowMs,
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
    },
    accessLinks: {
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
    },
    revisions: {
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
    },
    artifactFiles: {
      async insert(artifactId, revisionId, file, fallbackUploadedAt) {
        state.artifactFiles.set(`${artifactId}:${revisionId}:${file.path}`, {
          ...file,
          artifact_id: artifactId,
          revision_id: revisionId,
          uploaded_at: file.uploaded_at ?? fallbackUploadedAt,
        });
      },
      async listForArtifact(artifactId, revisionId) {
        return [...state.artifactFiles.values()].filter(
          (file) => file.artifact_id === artifactId && (revisionId === undefined || file.revision_id === revisionId),
        );
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
      async findByRevisionId(revisionId, workspaceId) {
        const session = [...state.uploadSessions.values()].find(
          (candidate) =>
            candidate.revision_id === revisionId && (!workspaceId || candidate.workspace_id === workspaceId),
        );
        return session ?? null;
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
      async listEffectivePage(input) {
        const cursorSetAt = input.cursor ? input.cursor.setAt.toISOString() : null;
        const cursorId = input.cursor?.id ?? null;
        return [...state.platformLockdowns.values()]
          .filter((lockdown) => lockdown.lifted_at === null)
          .filter(
            (lockdown) =>
              cursorSetAt === null ||
              cursorId === null ||
              lockdown.set_at < cursorSetAt ||
              (lockdown.set_at === cursorSetAt && lockdown.id < cursorId),
          )
          .sort(compareLockdownsForWeb)
          .slice(0, input.limit);
      },
      async insert(lockdown: PlatformLockdown): Promise<boolean> {
        const effective = [...state.platformLockdowns.values()].some(
          (existing) =>
            existing.scope === lockdown.scope &&
            existing.target_id === lockdown.target_id &&
            existing.lifted_at === null,
        );
        if (effective) {
          return false;
        }
        state.platformLockdowns.set(lockdown.id, lockdown);
        return true;
      },
      async markLifted(id, input): Promise<boolean> {
        const lockdown = state.platformLockdowns.get(id);
        if (!lockdown || lockdown.lifted_at !== null) {
          return false;
        }
        lockdown.lifted_at = input.liftedAt;
        lockdown.lifted_by = input.liftedBy;
        return true;
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
      async listOperatorPage(input) {
        const cursorOccurredAt = input.cursor ? input.cursor.occurredAt.toISOString() : null;
        const cursorId = input.cursor?.id ?? null;
        if (input.actions !== undefined && input.actions.length === 0) {
          return [];
        }
        const actionSet = input.actions ? new Set(input.actions) : null;
        return [...state.operationEvents.values()]
          .filter((event) => (input.workspaceId ? event.workspace_id === input.workspaceId : true))
          .filter((event) => (input.actorType ? event.actor_type === input.actorType : true))
          .filter((event) => (input.targetType ? event.target_type === input.targetType : true))
          .filter((event) => (input.requestId ? event.request_id === input.requestId : true))
          .filter((event) => (actionSet ? actionSet.has(event.action) : true))
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
