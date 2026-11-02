import { REVISION_FILE_ENTRY_BYTES } from "@agent-paste/config";
import type { SqlExecutor } from "../types.js";

export async function storageUsageQuery(db: SqlExecutor, workspaceId: string, now: string) {
  const { rows } = await db.query<Record<string, number | string>>(
    `
    select
      (select coalesce(sum(size_bytes),0) from content_blobs where workspace_id=$1 and content_format='single') as blob_bytes,
      (select coalesce(sum(af.size_bytes),0) from artifact_files af join revisions r on r.id=af.revision_id join artifacts a on a.id=af.artifact_id where af.workspace_id=$1 and af.storage_kind='revision' and r.status in ('draft','published') and a.status='active') as legacy_file_bytes,
      (select coalesce(sum(r.bundle_size_bytes),0) from revisions r join artifacts a on a.id=r.artifact_id where r.workspace_id=$1 and r.bundle_status='ready' and r.status in ('draft','published') and a.status='active') as bundle_bytes,
      (select coalesce(sum(r.file_count),0)*$3 from revisions r join artifacts a on a.id=r.artifact_id where r.workspace_id=$1 and r.status in ('draft','published') and a.status='active') as file_entry_bytes,
      ((select coalesce(sum(f.size_bytes),0) from upload_session_files f join upload_sessions s on s.id=f.upload_session_id where s.workspace_id=$1 and s.status in ('pending','ready') and s.expires_at>$2 and f.content_format='single' and f.uploaded_at is null)
       +(select coalesce(sum(c.size_bytes),0) from upload_session_chunks c join upload_sessions s on s.id=c.upload_session_id where s.workspace_id=$1 and s.status in ('pending','ready') and s.expires_at>$2 and c.uploaded_at is null)) as reserved_bytes
  `,
    [workspaceId, now, REVISION_FILE_ENTRY_BYTES],
  );
  const r = rows[0];
  if (!r) throw new Error("missing storage usage aggregate");
  return {
    breakdown: {
      blob_bytes: Number(r.blob_bytes),
      legacy_file_bytes: Number(r.legacy_file_bytes),
      bundle_bytes: Number(r.bundle_bytes),
      file_entry_bytes: Number(r.file_entry_bytes),
    },
    reserved_bytes: Number(r.reserved_bytes),
  };
}
