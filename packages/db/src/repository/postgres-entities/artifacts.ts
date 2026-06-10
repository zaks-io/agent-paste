import { artifactQueries, reparentTenantContent } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresArtifacts(ctx: PostgresContext): Entities["artifacts"] {
  const { sql, drizzle } = ctx;
  return {
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
         where status = 'active' and pinned_at is null and expires_at <= $1
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
         where status = 'active' and pinned_at is null and expires_at <= $1 and id = any($2::text[])`,
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
  };
}
