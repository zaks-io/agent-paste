import { and, asc, desc, eq, isNotNull, lt, or, type SQL, sql } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { defineSqlQuerySourceMap } from "../postgres/query-source.js";
import { artifactFiles, artifacts } from "../schema.js";
import type { Artifact, StoredFile, StoredFileStorageKind } from "../types.js";

export const artifactQueries = defineSqlQuerySourceMap("packages/db/src/queries/artifacts.ts", "artifactQueries", {
  async insert(db: DrizzleDb, row: Artifact) {
    await db.insert(artifacts).values({
      id: row.id,
      workspaceId: row.workspace_id,
      revisionId: row.revision_id,
      status: row.status,
      title: row.title,
      entrypoint: row.entrypoint,
      fileCount: row.file_count,
      sizeBytes: row.size_bytes,
      expiresAt: new Date(row.expires_at),
      pinnedAt: row.pinned_at ? new Date(row.pinned_at) : null,
      createdByType: row.created_by_type,
      createdById: row.created_by_id,
      accessLinkLockdownAt: row.access_link_lockdown_at ? new Date(row.access_link_lockdown_at) : null,
      deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
      deleteReason: row.delete_reason,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  },

  async findById(db: DrizzleDb, artifactId: string, workspaceId?: string): Promise<Artifact | null> {
    const predicate = workspaceId
      ? and(eq(artifacts.id, artifactId), eq(artifacts.workspaceId, workspaceId))
      : eq(artifacts.id, artifactId);
    const rows = await db.select().from(artifacts).where(predicate).limit(1);
    const row = rows[0];
    return row ? mapArtifact(row) : null;
  },

  async listFiltered(db: DrizzleDb, workspaceId?: string, status?: string): Promise<Artifact[]> {
    const conditions: SQL[] = [];
    if (workspaceId) {
      conditions.push(eq(artifacts.workspaceId, workspaceId));
    }
    if (status) {
      conditions.push(eq(artifacts.status, status));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = where
      ? await db.select().from(artifacts).where(where).orderBy(desc(artifacts.createdAt))
      : await db.select().from(artifacts).orderBy(desc(artifacts.createdAt));
    return rows.map(mapArtifact);
  },

  async listWebPage(
    db: DrizzleDb,
    input: { workspaceId: string; limit: number; cursor?: ArtifactCursor },
  ): Promise<Artifact[]> {
    const conditions: SQL[] = [eq(artifacts.workspaceId, input.workspaceId)];
    if (input.cursor) {
      const cursorPredicate = or(
        lt(artifacts.createdAt, input.cursor.createdAt),
        and(eq(artifacts.createdAt, input.cursor.createdAt), lt(artifacts.id, input.cursor.id)),
      );
      if (cursorPredicate) {
        conditions.push(cursorPredicate);
      }
    }
    const rows = await db
      .select()
      .from(artifacts)
      .where(and(...conditions))
      .orderBy(desc(artifacts.createdAt), desc(artifacts.id))
      .limit(input.limit);
    return rows.map(mapArtifact);
  },

  async updateExpiry(db: DrizzleDb, artifactId: string, expiresAt: string) {
    const expires = new Date(expiresAt);
    const rows = await db
      .update(artifacts)
      .set({ expiresAt: expires, updatedAt: new Date() })
      .where(eq(artifacts.id, artifactId))
      .returning({ id: artifacts.id, expiresAt: artifacts.expiresAt });
    const row = rows[0];
    return row ? { artifact_id: row.id, expires_at: row.expiresAt.toISOString() } : null;
  },

  async updatePublished(
    db: DrizzleDb,
    artifactId: string,
    input: {
      revisionId: string;
      title: string;
      entrypoint: string;
      fileCount: number;
      sizeBytes: number;
      expiresAt: string;
      updatedAt: string;
    },
  ) {
    await db
      .update(artifacts)
      .set({
        revisionId: input.revisionId,
        title: input.title,
        entrypoint: input.entrypoint,
        fileCount: input.fileCount,
        sizeBytes: input.sizeBytes,
        expiresAt: new Date(input.expiresAt),
        updatedAt: new Date(input.updatedAt),
      })
      .where(eq(artifacts.id, artifactId));
  },

  async updateTitle(db: DrizzleDb, artifactId: string, workspaceId: string, title: string, updatedAt: string) {
    const rows = await db
      .update(artifacts)
      .set({ title, updatedAt: new Date(updatedAt) })
      .where(and(eq(artifacts.id, artifactId), eq(artifacts.workspaceId, workspaceId)))
      .returning({ id: artifacts.id });
    return rows.length > 0;
  },

  async updateStaging(
    db: DrizzleDb,
    artifactId: string,
    input: {
      title: string;
      entrypoint: string;
      fileCount: number;
      sizeBytes: number;
      expiresAt: string;
      updatedAt: string;
    },
  ) {
    await db
      .update(artifacts)
      .set({
        title: input.title,
        entrypoint: input.entrypoint,
        fileCount: input.fileCount,
        sizeBytes: input.sizeBytes,
        expiresAt: new Date(input.expiresAt),
        updatedAt: new Date(input.updatedAt),
      })
      .where(eq(artifacts.id, artifactId));
  },

  async countPinned(db: DrizzleDb, workspaceId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(artifacts)
      .where(
        and(eq(artifacts.workspaceId, workspaceId), eq(artifacts.status, "active"), isNotNull(artifacts.pinnedAt)),
      );
    return Number(rows[0]?.count ?? 0);
  },

  async tryPinUnderCap(
    db: DrizzleDb,
    workspaceId: string,
    artifactId: string,
    pinnedAt: string,
    updatedAt: string,
    cap: number,
  ): Promise<"pinned" | "cap_exceeded" | "not_found"> {
    const pinnedAtDate = new Date(pinnedAt);
    const updatedAtDate = new Date(updatedAt);
    const rows = await db.execute<{ id: string }>(sql`
      update artifacts as a
      set pinned_at = ${pinnedAtDate},
          updated_at = ${updatedAtDate}
      where a.id = ${artifactId}
        and a.workspace_id = ${workspaceId}
        and a.status = 'active'
        and a.pinned_at is null
        and a.revision_id is not null
        and (
          select count(*)::int
          from artifacts
          where workspace_id = ${workspaceId}
            and status = 'active'
            and pinned_at is not null
        ) < ${cap}
      returning a.id
    `);
    if (rows.length > 0) {
      return "pinned";
    }
    const artifact = await artifactQueries.findById(db, artifactId, workspaceId);
    if (!artifact || artifact.status !== "active" || !artifact.revision_id) {
      return "not_found";
    }
    if (artifact.pinned_at) {
      return "pinned";
    }
    return "cap_exceeded";
  },

  async setPinnedAt(db: DrizzleDb, artifactId: string, pinnedAt: string | null, updatedAt: string): Promise<boolean> {
    const rows = await db
      .update(artifacts)
      .set({ pinnedAt: pinnedAt ? new Date(pinnedAt) : null, updatedAt: new Date(updatedAt) })
      .where(eq(artifacts.id, artifactId))
      .returning({ id: artifacts.id });
    return rows.length > 0;
  },

  async setAccessLinkLockdown(db: DrizzleDb, artifactId: string, lockdownAt: string | null): Promise<boolean> {
    const rows = await db
      .update(artifacts)
      .set({
        accessLinkLockdownAt: lockdownAt ? new Date(lockdownAt) : null,
        updatedAt: new Date(),
      })
      .where(eq(artifacts.id, artifactId))
      .returning({ id: artifacts.id });
    return rows.length > 0;
  },
});

export type ArtifactCursor = {
  createdAt: Date;
  id: string;
};

export const artifactFileQueries = defineSqlQuerySourceMap(
  "packages/db/src/queries/artifacts.ts",
  "artifactFileQueries",
  {
    async insert(db: DrizzleDb, artifactId: string, revisionId: string, file: StoredFile, fallbackUploadedAt: string) {
      await db.insert(artifactFiles).values({
        workspaceId: file.workspace_id,
        artifactId,
        revisionId,
        path: file.path,
        sizeBytes: file.size_bytes,
        servedContentType: file.content_type,
        r2Key: file.r2_key,
        sha256: file.sha256 ?? null,
        storageKind: file.storage_kind ?? "revision",
        uploadedAt: file.uploaded_at ? new Date(file.uploaded_at) : new Date(fallbackUploadedAt),
      });
    },

    async listForArtifact(db: DrizzleDb, artifactId: string, revisionId?: string): Promise<StoredFile[]> {
      const predicate = revisionId
        ? and(eq(artifactFiles.artifactId, artifactId), eq(artifactFiles.revisionId, revisionId))
        : eq(artifactFiles.artifactId, artifactId);
      const rows = await db.select().from(artifactFiles).where(predicate).orderBy(asc(artifactFiles.path));
      return rows.map(mapArtifactFile);
    },
  },
);

function mapArtifact(row: typeof artifacts.$inferSelect): Artifact {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    revision_id: row.revisionId ?? null,
    status: row.status as Artifact["status"],
    title: row.title,
    entrypoint: row.entrypoint,
    file_count: row.fileCount,
    size_bytes: Number(row.sizeBytes),
    expires_at: row.expiresAt.toISOString(),
    pinned_at: row.pinnedAt ? row.pinnedAt.toISOString() : null,
    created_by_type: row.createdByType as Artifact["created_by_type"],
    created_by_id: row.createdById,
    access_link_lockdown_at: row.accessLinkLockdownAt ? row.accessLinkLockdownAt.toISOString() : null,
    deleted_at: row.deletedAt ? row.deletedAt.toISOString() : null,
    delete_reason: row.deleteReason,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function mapArtifactFile(row: typeof artifactFiles.$inferSelect): StoredFile {
  return {
    workspace_id: row.workspaceId,
    artifact_id: row.artifactId,
    revision_id: row.revisionId,
    path: row.path,
    size_bytes: Number(row.sizeBytes),
    content_type: row.servedContentType,
    r2_key: row.r2Key,
    sha256: row.sha256,
    storage_kind: (row.storageKind ?? "revision") as StoredFileStorageKind,
    uploaded_at: row.uploadedAt.toISOString(),
  };
}
