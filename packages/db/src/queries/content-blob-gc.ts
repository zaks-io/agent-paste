import type { ContentBlob, SqlExecutor } from "../types.js";

export const CONTENT_BLOB_GC_AGE_MS = 24 * 60 * 60 * 1000;
// Keep these references together: every write path touches a live blob row under
// its row lock before adding a reference, so the outer age predicate also protects
// references that are not visible in the sweep's statement snapshot.
const unreferenced = `
 not exists (select 1 from artifact_files f join revisions r on r.id=f.revision_id join artifacts a on a.id=f.artifact_id where f.workspace_id=cb.workspace_id and f.sha256=cb.sha256 and f.size_bytes=cb.size_bytes and f.storage_kind='blob' and r.status in ('draft','published') and a.status='active')
 and not exists (select 1 from upload_session_files f join upload_sessions s on s.id=f.upload_session_id where f.workspace_id=cb.workspace_id and f.sha256=cb.sha256 and f.size_bytes=cb.size_bytes and f.storage_kind='blob' and s.status in ('pending','ready') and s.expires_at>$1)
 and not exists (select 1 from upload_session_chunks c join upload_sessions s on s.id=c.upload_session_id where c.workspace_id=cb.workspace_id and c.sha256=cb.sha256 and c.size_bytes=cb.size_bytes and s.status in ('pending','ready') and s.expires_at>$1)
 and not exists (select 1 from content_blob_chunks c join content_blobs p on p.workspace_id=c.workspace_id and p.sha256=c.sha256 and p.size_bytes=c.size_bytes where c.workspace_id=cb.workspace_id and c.chunk_sha256=cb.sha256 and c.chunk_size_bytes=cb.size_bytes and p.gc_state='live')
 and not exists (select 1 from revisions r join artifacts a on a.id=r.artifact_id where r.workspace_id=cb.workspace_id and r.file_map_sha256=cb.sha256 and r.file_map_size_bytes=cb.size_bytes and r.status in ('draft','published') and a.status='active')`;

type GcRow = Omit<ContentBlob, "created_at" | "updated_at" | "gc_marked_at"> & {
  created_at: Date | string;
  updated_at: Date | string;
  gc_marked_at: Date | string | null;
};
function mapped(r: GcRow): ContentBlob {
  return {
    ...r,
    size_bytes: Number(r.size_bytes),
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
    gc_marked_at: r.gc_marked_at ? new Date(r.gc_marked_at).toISOString() : null,
  };
}
export async function markUnreferencedContentBlobs(executor: SqlExecutor, input: { now: string; limit: number }) {
  const retry = await executor.query<GcRow>(
    "select * from content_blobs where gc_state='deleting' order by gc_marked_at, workspace_id, sha256, size_bytes limit $1",
    [input.limit],
  );
  if (retry.rows.length === input.limit) return retry.rows.map(mapped);
  const floor = new Date(Date.parse(input.now) - CONTENT_BLOB_GC_AGE_MS).toISOString();
  const rows = await executor.query<GcRow>(
    `update content_blobs cb set gc_state='deleting', gc_marked_at=$1
    where (cb.workspace_id,cb.sha256,cb.size_bytes) in (
      select cb.workspace_id,cb.sha256,cb.size_bytes from content_blobs cb where cb.gc_state='live' and cb.updated_at<$2 and ${unreferenced}
      order by cb.updated_at,cb.workspace_id,cb.sha256,cb.size_bytes limit $3 for update skip locked
    ) and cb.gc_state='live' and cb.updated_at<$2 and ${unreferenced}
    returning cb.*`,
    [input.now, floor, input.limit - retry.rows.length],
  );
  return [...retry.rows, ...rows.rows].map(mapped);
}
export async function finishContentBlobDeletion(executor: SqlExecutor, blob: ContentBlob) {
  await executor.query(
    "delete from content_blobs where workspace_id=$1 and sha256=$2 and size_bytes=$3 and gc_state='deleting'",
    [blob.workspace_id, blob.sha256, blob.size_bytes],
  );
}
export async function collectContentBlobGarbage(
  executor: SqlExecutor,
  input: { now: string; limit: number; deleteObjects?: (keys: string[]) => Promise<unknown> },
) {
  const marked = await markUnreferencedContentBlobs(executor, input);
  // Hold the tombstone row locks through R2 deletion and row removal. Overlapping
  // sweeps must not retain an old key and delete bytes after a new upload reuses it.
  const deleted = await executor.transaction(async (tx) => {
    const locked = await tx.query<GcRow>(
      "select * from content_blobs where gc_state='deleting' order by gc_marked_at,workspace_id,sha256,size_bytes limit $1 for update skip locked",
      [input.limit],
    );
    const owned = locked.rows.map(mapped);
    const physical = owned.filter((b) => b.content_format !== "chunked-v1" && b.r2_cleanup_eligible === true);
    if (input.deleteObjects)
      for (let n = 0; n < physical.length; n += 1000)
        await input.deleteObjects(physical.slice(n, n + 1000).map((b) => b.r2_key));
    let count = 0;
    for (const b of owned) {
      if (b.content_format !== "chunked-v1" && b.r2_cleanup_eligible === true && !input.deleteObjects) continue;
      await finishContentBlobDeletion(tx, b);
      count++;
    }
    return count;
  });
  return { marked, deleted };
}
