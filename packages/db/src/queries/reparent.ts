import { withSqlQuerySource } from "../postgres/query-source.js";
import type { SqlExecutor } from "../types.js";
import { upsertReparentedContentBlobs } from "./reparent-blobs.js";

export type ReparentTenantContentResult = {
  artifact_ids: string[];
};

export async function reparentTenantContent(
  sql: SqlExecutor,
  input: {
    fromWorkspaceId: string;
    toWorkspaceId: string;
    updatedAt: string;
    minArtifactExpiresAt: string;
  },
): Promise<ReparentTenantContentResult> {
  return withSqlQuerySource(sqlQuerySource("reparentTenantContent"), () =>
    sql.transaction(async (tx) => {
      await tx.query("set constraints all deferred");

      const artifactResult = await tx.query<{ id: string }>(
        `select id
       from artifacts
       where workspace_id = $1`,
        [input.fromWorkspaceId],
      );
      const artifactIds = artifactResult.rows.map((row) => row.id);

      if (artifactIds.length > 0) {
        await tx.query(
          `update artifacts
         set workspace_id = $1,
             expires_at = greatest(expires_at, $2::timestamptz),
             updated_at = $3::timestamptz
         where workspace_id = $4`,
          [input.toWorkspaceId, input.minArtifactExpiresAt, input.updatedAt, input.fromWorkspaceId],
        );
        await tx.query(`update revisions set workspace_id = $1 where workspace_id = $2`, [
          input.toWorkspaceId,
          input.fromWorkspaceId,
        ]);
        await tx.query(`update access_links set workspace_id = $1 where workspace_id = $2`, [
          input.toWorkspaceId,
          input.fromWorkspaceId,
        ]);
        await tx.query(`update safety_warnings set workspace_id = $1 where workspace_id = $2`, [
          input.toWorkspaceId,
          input.fromWorkspaceId,
        ]);
        await tx.query(`update upload_sessions set workspace_id = $1 where workspace_id = $2`, [
          input.toWorkspaceId,
          input.fromWorkspaceId,
        ]);
        await tx.query(
          `update upload_session_files
         set workspace_id = $1,
             r2_key = case
               when r2_key like $3 || '%' then $4 || substring(r2_key from length($3) + 1)
               else r2_key
             end
         where workspace_id = $2
           and storage_kind = 'blob'`,
          [
            input.toWorkspaceId,
            input.fromWorkspaceId,
            `workspaces/${input.fromWorkspaceId}/blobs/`,
            `workspaces/${input.toWorkspaceId}/blobs/`,
          ],
        );
        await tx.query(
          `update upload_session_files
         set workspace_id = $1
         where workspace_id = $2
           and storage_kind = 'revision'`,
          [input.toWorkspaceId, input.fromWorkspaceId],
        );
        await tx.query(
          `update artifact_files
         set workspace_id = $1,
             r2_key = case
               when r2_key like $3 || '%' then $4 || substring(r2_key from length($3) + 1)
               else r2_key
             end
         where workspace_id = $2
           and storage_kind = 'blob'`,
          [
            input.toWorkspaceId,
            input.fromWorkspaceId,
            `workspaces/${input.fromWorkspaceId}/blobs/`,
            `workspaces/${input.toWorkspaceId}/blobs/`,
          ],
        );
        await tx.query(
          `update artifact_files
         set workspace_id = $1
         where workspace_id = $2
           and storage_kind = 'revision'`,
          [input.toWorkspaceId, input.fromWorkspaceId],
        );
        await upsertReparentedContentBlobs(tx, {
          workspaceId: input.toWorkspaceId,
          updatedAt: input.updatedAt,
        });
      }

      return { artifact_ids: artifactIds };
    }),
  );
}

function sqlQuerySource(functionName: string) {
  return {
    filepath: "packages/db/src/queries/reparent.ts",
    functionName,
    namespace: "packages.db.src.queries.reparent",
  };
}
