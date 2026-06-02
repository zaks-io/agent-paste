import type { SqlExecutor } from "../types.js";

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
  return sql.transaction(async (tx) => {
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
      await tx.query(`update upload_session_files set workspace_id = $1 where workspace_id = $2`, [
        input.toWorkspaceId,
        input.fromWorkspaceId,
      ]);
      await tx.query(`update artifact_files set workspace_id = $1 where workspace_id = $2`, [
        input.toWorkspaceId,
        input.fromWorkspaceId,
      ]);
    }

    return { artifact_ids: artifactIds };
  });
}
