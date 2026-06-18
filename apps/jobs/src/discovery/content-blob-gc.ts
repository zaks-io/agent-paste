import { type SqlExecutor, withSqlQuerySource } from "@agent-paste/db";
import { CONTENT_BLOB_GC_SWEEP_CAP } from "../constants.js";
import { withPlatformScope } from "../db.js";
import { logOp } from "../op-log.js";
import type { SweepResult } from "./types.js";

type BlobGcRow = {
  workspace_id: string;
  sha256: string;
  size_bytes: number;
  r2_key: string;
};

export async function runContentBlobGc(executor: SqlExecutor, now: string): Promise<SweepResult> {
  const limit = CONTENT_BLOB_GC_SWEEP_CAP;
  const deleted = await deleteUnreferencedBlobRows(withPlatformScope(executor), now, limit);
  const cap_hit = deleted.rows.length === CONTENT_BLOB_GC_SWEEP_CAP;
  logOp("cron.content_blob_gc", { discovered: deleted.rows.length, deleted_rows: deleted.rows.length, cap_hit });
  return { discovered: deleted.rows.length, enqueued: 0, cap_hit };
}

function deleteUnreferencedBlobRows(executor: SqlExecutor, now: string, limit: number) {
  return withSource("deleteUnreferencedBlobRows", () =>
    executor.query<BlobGcRow>(
      `delete from content_blobs cb
     where ctid in (
       select cb_inner.ctid
       from content_blobs cb_inner
       where not exists (
         select 1
         from artifact_files af
         inner join revisions r
           on r.workspace_id = af.workspace_id
          and r.artifact_id = af.artifact_id
          and r.id = af.revision_id
         inner join artifacts a
           on a.workspace_id = af.workspace_id
          and a.id = af.artifact_id
         where af.workspace_id = cb_inner.workspace_id
           and af.sha256 = cb_inner.sha256
           and af.size_bytes = cb_inner.size_bytes
           and af.storage_kind = 'blob'
           and a.status = 'active'
           and r.status in ('draft', 'published')
       )
       and not exists (
         select 1
         from upload_session_files usf
         inner join upload_sessions us on us.id = usf.upload_session_id
         where usf.workspace_id = cb_inner.workspace_id
           and usf.sha256 = cb_inner.sha256
           and usf.size_bytes = cb_inner.size_bytes
           and usf.storage_kind = 'blob'
           and us.status = 'pending'
           and us.expires_at > $1
       )
       order by cb_inner.updated_at asc
       limit $2
     )
     returning workspace_id, sha256, size_bytes, r2_key`,
      [now, limit],
    ),
  );
}

function withSource<T>(functionName: string, run: () => T): T {
  return withSqlQuerySource(
    {
      filepath: "apps/jobs/src/discovery/content-blob-gc.ts",
      functionName,
      namespace: "apps.jobs.src.discovery.content-blob-gc",
    },
    run,
  );
}
