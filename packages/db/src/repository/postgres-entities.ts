import type { DrizzleDb } from "../postgres/drizzle.js";
import {
  accessLinkQueries,
  apiKeyQueries,
  artifactFileQueries,
  artifactQueries,
  claimTokenQueries,
  operationEventQueries,
  platformLockdownQueries,
  reparentTenantContent,
  revisionQueries,
  safetyWarningQueries,
  uploadSessionFileQueries,
  uploadSessionQueries,
  workspaceMemberQueries,
  workspaceQueries,
} from "../queries/index.js";
import type { SqlExecutor } from "../types.js";
import type { Entities } from "./ports.js";

export type PostgresContext = { sql: SqlExecutor; drizzle: DrizzleDb };

// Bind the grouped Entities accessor to one scope-bound, drizzle-aware transaction.
// Most methods forward to the existing query objects; the cleanup/delete helpers
// keep the original raw SQL so RLS-scoped batch updates stay byte-for-byte identical.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: entity method bag (123 lines), pending ratchet toward 60 — see docs/ops/complexity-todo.md
export function postgresEntities(ctx: PostgresContext): Entities {
  const { sql, drizzle } = ctx;
  return {
    workspaces: {
      insert: (workspace) => workspaceQueries.insert(drizzle, workspace),
      findById: (id) => workspaceQueries.findById(drizzle, id),
      listAll: () => workspaceQueries.listAll(drizzle),
      update: (id, input) => workspaceQueries.update(drizzle, id, input),
      markClaimed: (id, input) => workspaceQueries.markClaimed(drizzle, id, input),
    },
    apiKeys: {
      insert: (apiKey) => apiKeyQueries.insert(drizzle, apiKey),
      findById: (id) => apiKeyQueries.findById(drizzle, id),
      findByPublicId: (publicId) => apiKeyQueries.findByPublicId(drizzle, publicId),
      listForWorkspace: (workspaceId) => apiKeyQueries.listForWorkspace(drizzle, workspaceId),
      updateLastUsedAt: (id, lastUsedAt) => apiKeyQueries.updateLastUsedAt(drizzle, id, lastUsedAt),
      updateRevokedAt: (id, revokedAt) => apiKeyQueries.updateRevokedAt(drizzle, id, revokedAt),
      revokeAllForWorkspace: (workspaceId, revokedAt) =>
        apiKeyQueries.revokeAllForWorkspace(drizzle, workspaceId, revokedAt),
    },
    claimTokens: {
      insert: (claimToken) => claimTokenQueries.insert(drizzle, claimToken),
      findById: (id, workspaceId) => claimTokenQueries.findById(drizzle, id, workspaceId),
      findByPublicId: (publicId) => claimTokenQueries.findByPublicId(drizzle, publicId),
      markRedeemed: (id, redeemedAt) => claimTokenQueries.markRedeemed(drizzle, id, redeemedAt),
    },
    members: {
      insert: (member) => workspaceMemberQueries.insert(drizzle, member),
      findById: (id) => workspaceMemberQueries.findById(drizzle, id),
      findByWorkOsUserId: (workosUserId) => workspaceMemberQueries.findByWorkOsUserId(drizzle, workosUserId),
      updateSeen: (id, input) => workspaceMemberQueries.updateSeen(drizzle, id, input),
    },
    artifacts: {
      insert: (artifact) => artifactQueries.insert(drizzle, artifact),
      findById: (artifactId, workspaceId) => artifactQueries.findById(drizzle, artifactId, workspaceId),
      listFiltered: (workspaceId, status) => artifactQueries.listFiltered(drizzle, workspaceId, status),
      listWebPage: (input) => artifactQueries.listWebPage(drizzle, input),
      updateExpiry: (artifactId, expiresAt) => artifactQueries.updateExpiry(drizzle, artifactId, expiresAt),
      countPinned: (workspaceId) => artifactQueries.countPinned(drizzle, workspaceId),
      tryPinUnderCap: (workspaceId, artifactId, pinnedAt, updatedAt, cap) =>
        artifactQueries.tryPinUnderCap(drizzle, workspaceId, artifactId, pinnedAt, updatedAt, cap),
      setPinnedAt: (artifactId, pinnedAt, updatedAt) =>
        artifactQueries.setPinnedAt(drizzle, artifactId, pinnedAt, updatedAt),
      updatePublished: (artifactId, input) => artifactQueries.updatePublished(drizzle, artifactId, input),
      updateStaging: (artifactId, input) => artifactQueries.updateStaging(drizzle, artifactId, input),
      updateTitle: (artifactId, workspaceId, title, updatedAt) =>
        artifactQueries.updateTitle(drizzle, artifactId, workspaceId, title, updatedAt),
      markDeleted: async (artifactId, deletedAt) => {
        await sql.query(
          `update artifacts
           set status = 'deleted', deleted_at = $2, delete_reason = 'admin_delete', updated_at = $2
           where id = $1`,
          [artifactId, deletedAt],
        );
      },
      listExpiring: async (now, limit) => {
        const result = await sql.query<{ id: string }>(
          `select id
           from artifacts
           where status = 'active' and expires_at <= $1
           order by expires_at asc
           limit $2`,
          [now, limit],
        );
        return result.rows;
      },
      expireBatch: async (now, ids) => {
        await sql.query(
          `update artifacts
           set status = 'expired', deleted_at = $1, delete_reason = 'expired', updated_at = $1
           where status = 'active' and expires_at <= $1 and id = any($2::text[])`,
          [now, ids],
        );
      },
      setAccessLinkLockdown: (artifactId, lockdownAt) =>
        artifactQueries.setAccessLinkLockdown(drizzle, artifactId, lockdownAt),
      reparentWorkspace: async (fromWorkspaceId, toWorkspaceId, minExpiresAt, updatedAt) => {
        const result = await reparentTenantContent(sql, {
          fromWorkspaceId,
          toWorkspaceId,
          updatedAt,
          minArtifactExpiresAt: minExpiresAt,
        });
        return result.artifact_ids;
      },
    },
    accessLinks: {
      insert: (link) => accessLinkQueries.insert(drizzle, link),
      findById: (id, workspaceId) => accessLinkQueries.findById(drizzle, id, workspaceId),
      findByPublicId: (publicId) => accessLinkQueries.findByPublicId(drizzle, publicId),
      listForArtifact: (artifactId) => accessLinkQueries.listForArtifact(drizzle, artifactId),
      listForWorkspace: (workspaceId) => accessLinkQueries.listForWorkspace(drizzle, workspaceId),
      revoke: (id, revokedAt) => accessLinkQueries.revoke(drizzle, id, revokedAt),
      updateExpiresAt: (id, expiresAt) => accessLinkQueries.updateExpiresAt(drizzle, id, expiresAt),
    },
    revisions: {
      insert: (revision) => revisionQueries.insert(drizzle, revision),
      findById: (revisionId, workspaceId) => revisionQueries.findById(drizzle, revisionId, workspaceId),
      findDraftForArtifact: (artifactId) => revisionQueries.findDraftForArtifact(drizzle, artifactId),
      listForArtifact: (artifactId) => revisionQueries.listForArtifact(drizzle, artifactId),
      nextRevisionNumber: (artifactId) => revisionQueries.nextRevisionNumber(drizzle, artifactId),
      publish: (input) => revisionQueries.publish(drizzle, input),
      markRetained: (input) => revisionQueries.markRetained(drizzle, input),
    },
    artifactFiles: {
      insert: (artifactId, revisionId, file, fallbackUploadedAt) =>
        artifactFileQueries.insert(drizzle, artifactId, revisionId, file, fallbackUploadedAt),
      listForArtifact: (artifactId, revisionId) => artifactFileQueries.listForArtifact(drizzle, artifactId, revisionId),
    },
    safetyWarnings: {
      listForRevision: (workspaceId, revisionId) =>
        safetyWarningQueries.listForRevision(drizzle, workspaceId, revisionId),
    },
    uploadSessions: {
      insert: (session) => uploadSessionQueries.insert(drizzle, session),
      findById: (sessionId, workspaceId) => uploadSessionQueries.findById(drizzle, sessionId, workspaceId),
      findByRevisionId: (revisionId, workspaceId) =>
        uploadSessionQueries.findByRevisionId(drizzle, revisionId, workspaceId),
      markFinalized: (sessionId, finalizedAt) => uploadSessionQueries.markFinalized(drizzle, sessionId, finalizedAt),
      listExpiring: async (now, limit) => {
        const result = await sql.query<{ id: string }>(
          `select id
           from upload_sessions
           where status = 'pending' and expires_at <= $1
           order by expires_at asc
           limit $2`,
          [now, limit],
        );
        return result.rows;
      },
      expireBatch: async (now, ids) => {
        await sql.query(
          `update upload_sessions
           set status = 'expired'
           where status = 'pending' and expires_at <= $1 and id = any($2::text[])`,
          [now, ids],
        );
      },
    },
    uploadSessionFiles: {
      insert: (sessionId, file) => uploadSessionFileQueries.insert(drizzle, sessionId, file),
      listForSession: (sessionId) => uploadSessionFileQueries.listForSession(drizzle, sessionId),
      recordUpload: (input) => uploadSessionFileQueries.recordUpload(drizzle, input),
    },
    platformLockdowns: {
      findEffective: (scope, targetId) => platformLockdownQueries.findEffective(drizzle, scope, targetId),
      listEffectivePage: (input) => platformLockdownQueries.listEffectivePage(drizzle, input),
      insert: (lockdown) => platformLockdownQueries.insert(drizzle, lockdown),
      markLifted: (id, input) => platformLockdownQueries.markLifted(drizzle, id, input),
    },
    operationEvents: {
      insert: (input) => operationEventQueries.insert(drizzle, input),
      listAll: () => operationEventQueries.listAll(drizzle),
      listForWorkspace: (workspaceId) => operationEventQueries.listForWorkspace(drizzle, workspaceId),
      listWebPage: (input) => operationEventQueries.listWebPage(drizzle, input),
      listOperatorPage: (input) => operationEventQueries.listOperatorPage(drizzle, input),
      listIdsForTarget: (targetId) => operationEventQueries.listIdsForTarget(drizzle, targetId),
    },
  };
}
