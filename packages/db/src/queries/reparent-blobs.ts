import { withSqlQuerySource } from "../postgres/query-source.js";
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
  const sourcePrefix = workspaceBlobR2KeyPrefix(fromWorkspaceId);
  if (!r2Key.startsWith(sourcePrefix)) {
    throw new Error(`reparent_blob_r2_key_prefix_mismatch:${r2Key}`);
  }
  return `${workspaceBlobR2KeyPrefix(toWorkspaceId)}${r2Key.slice(sourcePrefix.length)}`;
}

export async function upsertReparentedContentBlobs(
  sql: SqlExecutor,
  input: { workspaceId: string; updatedAt: string },
): Promise<void> {
  await withSqlQuerySource(
    {
      filepath: "packages/db/src/queries/reparent-blobs.ts",
      functionName: "upsertReparentedContentBlobs",
      namespace: "packages.db.src.queries.reparent-blobs",
    },
    () =>
      sql.query(
        `insert into content_blobs (workspace_id, sha256, size_bytes, r2_key, created_at, updated_at)
     select distinct on (blobs.sha256, blobs.size_bytes)
       blobs.workspace_id,
       blobs.sha256,
       blobs.size_bytes,
       blobs.r2_key,
       $2::timestamptz,
       $2::timestamptz
     from (
       select af.workspace_id, af.sha256, af.size_bytes, af.r2_key, af.path
       from artifact_files af
       inner join revisions r
         on r.workspace_id = af.workspace_id
        and r.artifact_id = af.artifact_id
        and r.id = af.revision_id
       inner join artifacts a
         on a.workspace_id = af.workspace_id
        and a.id = af.artifact_id
       where af.workspace_id = $1
         and af.storage_kind = 'blob'
         and af.sha256 is not null
         and a.status = 'active'
         and r.status in ('draft', 'published')
       union
       select usf.workspace_id, usf.sha256, usf.size_bytes, usf.r2_key, usf.path
       from upload_session_files usf
       inner join upload_sessions us on us.id = usf.upload_session_id
       where usf.workspace_id = $1
         and usf.storage_kind = 'blob'
         and usf.sha256 is not null
         and usf.uploaded_at is not null
         and us.status = 'pending'
         and us.expires_at > $2::timestamptz
     ) blobs
     order by blobs.sha256, blobs.size_bytes, blobs.path
     on conflict (workspace_id, sha256, size_bytes)
     do update set r2_key = excluded.r2_key, updated_at = excluded.updated_at`,
        [input.workspaceId, input.updatedAt],
      ),
  );
}
