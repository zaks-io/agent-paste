import { and, eq, or, sql } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { defineSqlQuerySourceMap } from "../postgres/query-source.js";
import { repositoryError } from "../repository-error.js";
import { contentBlobs, revisions } from "../schema.js";
import type { ContentBlob } from "../types.js";
import type { WorkspaceBlobRef } from "./reparent-blobs.js";

export const contentBlobQueries = defineSqlQuerySourceMap(
  "packages/db/src/queries/content-blobs.ts",
  "contentBlobQueries",
  {
    async find(
      db: DrizzleDb,
      input: { workspaceId: string; sha256: string; sizeBytes: number },
    ): Promise<ContentBlob | null> {
      const rows = await db
        .select()
        .from(contentBlobs)
        .where(
          and(
            eq(contentBlobs.workspaceId, input.workspaceId),
            eq(contentBlobs.sha256, input.sha256),
            eq(contentBlobs.sizeBytes, input.sizeBytes),
          ),
        )
        .limit(1);
      return rows[0] ? mapContentBlob(rows[0]) : null;
    },

    async findReusableAndTouch(
      db: DrizzleDb,
      workspaceId: string,
      files: Array<{ sha256: string; sizeBytes: number }>,
      updatedAt: string,
    ): Promise<ContentBlob[]> {
      const uniqueFiles = [
        ...new Map(files.map((file) => [`${file.sha256}:${file.sizeBytes}`, file] as const)).values(),
      ];
      if (uniqueFiles.length === 0) {
        return [];
      }
      const filePredicate = or(
        ...uniqueFiles.map((file) =>
          and(eq(contentBlobs.sha256, file.sha256), eq(contentBlobs.sizeBytes, file.sizeBytes)),
        ),
      );
      if (!filePredicate) {
        return [];
      }
      const rows = await db
        .update(contentBlobs)
        .set({ updatedAt: new Date(updatedAt) })
        .where(
          and(
            eq(contentBlobs.workspaceId, workspaceId),
            eq(contentBlobs.gcState, "live"),
            filePredicate,
            // Map rows reserve bytes before R2 materialization, so they cannot prove an upload exists.
            sql`not exists (select 1 from ${revisions}
            where ${revisions.workspaceId} = ${contentBlobs.workspaceId}
              and ${revisions.fileMapSha256} = ${contentBlobs.sha256}
              and ${revisions.fileMapSizeBytes} = ${contentBlobs.sizeBytes})`,
          ),
        )
        .returning();
      if (rows.length < uniqueFiles.length) {
        const unavailable = await db
          .select()
          .from(contentBlobs)
          .where(and(eq(contentBlobs.workspaceId, workspaceId), eq(contentBlobs.gcState, "deleting"), filePredicate))
          .limit(1);
        if (unavailable.length) repositoryError("blob_cleanup_in_progress");
      }
      return rows.map(mapContentBlob);
    },

    async upsert(db: DrizzleDb, blob: ContentBlob) {
      await upsertContentBlobs(db, [blob]);
    },

    async upsertMany(db: DrizzleDb, blobs: ContentBlob[]) {
      await upsertContentBlobs(db, blobs);
    },

    async listForReparent(db: DrizzleDb, workspaceId: string, now: string): Promise<WorkspaceBlobRef[]> {
      const rows = await db.execute<WorkspaceBlobRef>(sql`
      select distinct sha256, size_bytes, r2_key
      from (
        select af.sha256, af.size_bytes, af.r2_key
        from artifact_files af
        inner join revisions r
          on r.workspace_id = af.workspace_id
         and r.artifact_id = af.artifact_id
         and r.id = af.revision_id
        inner join artifacts a
          on a.workspace_id = af.workspace_id
         and a.id = af.artifact_id
        where af.workspace_id = ${workspaceId}
          and af.storage_kind = 'blob'
          and af.sha256 is not null
          and a.status = 'active'
          and r.status in ('draft', 'published')
        union
        select usf.sha256, usf.size_bytes, usf.r2_key
        from upload_session_files usf
        inner join upload_sessions us on us.id = usf.upload_session_id
        where usf.workspace_id = ${workspaceId}
          and usf.storage_kind = 'blob'
          and usf.sha256 is not null
          and usf.uploaded_at is not null
          and us.status in ('pending','ready')
          and us.expires_at > ${now}
      ) blobs
    `);
      return rows;
    },
  },
);

async function upsertContentBlobs(db: DrizzleDb, blobs: ContentBlob[]) {
  const uniqueBlobs = [
    ...new Map(blobs.map((blob) => [`${blob.workspace_id}:${blob.sha256}:${blob.size_bytes}`, blob] as const)).values(),
  ];
  if (uniqueBlobs.length === 0) {
    return;
  }
  const result = await db
    .insert(contentBlobs)
    .values(
      uniqueBlobs.map((blob) => ({
        workspaceId: blob.workspace_id,
        sha256: blob.sha256,
        sizeBytes: blob.size_bytes,
        r2Key: blob.r2_key,
        contentFormat: blob.content_format ?? "single",
        r2CleanupEligible: blob.r2_cleanup_eligible ?? true,
        createdAt: new Date(blob.created_at),
        updatedAt: new Date(blob.updated_at),
      })),
    )
    .onConflictDoUpdate({
      target: [contentBlobs.workspaceId, contentBlobs.sha256, contentBlobs.sizeBytes],
      set: {
        r2Key: sql`excluded.r2_key`,
        updatedAt: sql`excluded.updated_at`,
        contentFormat: sql`case when content_blobs.content_format='single' then 'single' else excluded.content_format end`,
      },
      setWhere: eq(contentBlobs.gcState, "live"),
    })
    .returning({ sha256: contentBlobs.sha256 });
  if (result.length !== uniqueBlobs.length) repositoryError("blob_cleanup_in_progress");
}

function mapContentBlob(
  row: Pick<
    typeof contentBlobs.$inferSelect,
    | "workspaceId"
    | "sha256"
    | "sizeBytes"
    | "r2Key"
    | "createdAt"
    | "updatedAt"
    | "contentFormat"
    | "gcState"
    | "gcMarkedAt"
    | "r2CleanupEligible"
  >,
): ContentBlob {
  return {
    content_format: row.contentFormat,
    gc_state: row.gcState,
    gc_marked_at: row.gcMarkedAt?.toISOString() ?? null,
    r2_cleanup_eligible: row.r2CleanupEligible,
    workspace_id: row.workspaceId,
    sha256: row.sha256,
    size_bytes: Number(row.sizeBytes),
    r2_key: row.r2Key,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
