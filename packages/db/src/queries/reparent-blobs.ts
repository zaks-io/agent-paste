import type { SqlExecutor } from "../types.js";

export type WorkspaceBlobRef = {
  sha256: string;
  size_bytes: number;
  r2_key: string;
};

export function workspaceBlobR2KeyPrefix(workspaceId: string): string {
  return `workspaces/${workspaceId}/blobs/`;
}

export function remapWorkspaceBlobR2Key(r2Key: string, fromWorkspaceId: string, toWorkspaceId: string): string {
  return r2Key.replace(workspaceBlobR2KeyPrefix(fromWorkspaceId), workspaceBlobR2KeyPrefix(toWorkspaceId));
}

export async function listWorkspaceBlobsForReparent(
  sql: SqlExecutor,
  workspaceId: string,
): Promise<WorkspaceBlobRef[]> {
  const result = await sql.query<WorkspaceBlobRef>(
    `select distinct sha256, size_bytes, r2_key
     from (
       select sha256, size_bytes, r2_key
       from artifact_files
       where workspace_id = $1
         and storage_kind = 'blob'
         and sha256 is not null
       union
       select sha256, size_bytes, r2_key
       from upload_session_files
       where workspace_id = $1
         and storage_kind = 'blob'
         and sha256 is not null
     ) blobs`,
    [workspaceId],
  );
  return result.rows;
}

export async function upsertReparentedContentBlobs(
  sql: SqlExecutor,
  input: { workspaceId: string; updatedAt: string },
): Promise<void> {
  await sql.query(
    `insert into content_blobs (workspace_id, sha256, size_bytes, r2_key, created_at, updated_at)
     select distinct on (af.sha256, af.size_bytes)
       af.workspace_id,
       af.sha256,
       af.size_bytes,
       af.r2_key,
       $2::timestamptz,
       $2::timestamptz
     from artifact_files af
     where af.workspace_id = $1
       and af.storage_kind = 'blob'
       and af.sha256 is not null
     order by af.sha256, af.size_bytes, af.path
     on conflict (workspace_id, sha256, size_bytes)
     do update set r2_key = excluded.r2_key, updated_at = excluded.updated_at`,
    [input.workspaceId, input.updatedAt],
  );
}
