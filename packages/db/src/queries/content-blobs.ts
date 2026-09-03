import { and, eq, or, sql } from "drizzle-orm";
import { DEFAULT_UPLOAD_SESSION_TTL_MS } from "../policy.js";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { defineSqlQuerySourceMap } from "../postgres/query-source.js";
import { contentBlobs } from "../schema.js";
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
        .where(and(eq(contentBlobs.workspaceId, workspaceId), filePredicate))
        .returning();
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
          and us.status = 'pending'
          and us.expires_at > ${now}
      ) blobs
    `);
      return rows;
    },

    async deleteUnreferenced(db: DrizzleDb, input: { now: string; limit: number }): Promise<ContentBlob[]> {
      // Age floor derived from the shared upload-session TTL (same constant the
      // in-memory path uses), so both backends stay aligned if the TTL changes.
      // A blob touched within one TTL of `now` may be referenced by an in-flight
      // create-upload-session the NOT EXISTS checks cannot see yet.
      const ageFloor = new Date(new Date(input.now).getTime() - DEFAULT_UPLOAD_SESSION_TTL_MS).toISOString();
      const rows = await db.execute<{
        workspace_id: string;
        sha256: string;
        size_bytes: number;
        r2_key: string;
        created_at: Date;
        updated_at: Date;
      }>(sql`
      delete from content_blobs cb
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
            and us.expires_at > ${input.now}
        )
        -- Age floor (see ageFloor above): the NOT EXISTS checks see only
        -- committed rows, so a blob reused by an in-flight create-upload-session
        -- could otherwise be purged in the window before that session commits.
        and cb_inner.updated_at < ${ageFloor}::timestamptz
        order by cb_inner.updated_at asc
        limit ${input.limit}
      )
      returning workspace_id, sha256, size_bytes, r2_key, created_at, updated_at
    `);
      return rows.map((row) =>
        mapContentBlob({
          workspaceId: row.workspace_id,
          sha256: row.sha256,
          sizeBytes: Number(row.size_bytes),
          r2Key: row.r2_key,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        }),
      );
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
  await db
    .insert(contentBlobs)
    .values(
      uniqueBlobs.map((blob) => ({
        workspaceId: blob.workspace_id,
        sha256: blob.sha256,
        sizeBytes: blob.size_bytes,
        r2Key: blob.r2_key,
        createdAt: new Date(blob.created_at),
        updatedAt: new Date(blob.updated_at),
      })),
    )
    .onConflictDoUpdate({
      target: [contentBlobs.workspaceId, contentBlobs.sha256, contentBlobs.sizeBytes],
      set: { r2Key: sql`excluded.r2_key`, updatedAt: sql`excluded.updated_at` },
    });
}

function mapContentBlob(row: typeof contentBlobs.$inferSelect): ContentBlob {
  return {
    workspace_id: row.workspaceId,
    sha256: row.sha256,
    size_bytes: Number(row.sizeBytes),
    r2_key: row.r2Key,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
