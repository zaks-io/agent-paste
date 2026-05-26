import { and, asc, desc, eq, lt, or, type SQL } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { artifactFiles, artifacts } from "../schema.js";
import type { Artifact, StoredFile } from "../types.js";

export const artifactQueries = {
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
      createdByApiKeyId: row.created_by_api_key_id,
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
};

export type ArtifactCursor = {
  createdAt: Date;
  id: string;
};

export const artifactFileQueries = {
  async insert(db: DrizzleDb, artifactId: string, revisionId: string, file: StoredFile, fallbackUploadedAt: string) {
    await db.insert(artifactFiles).values({
      workspaceId: file.workspace_id,
      artifactId,
      revisionId,
      path: file.path,
      sizeBytes: file.size_bytes,
      servedContentType: file.content_type,
      r2Key: file.r2_key,
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
};

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
    created_by_api_key_id: row.createdByApiKeyId,
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
    uploaded_at: row.uploadedAt.toISOString(),
  };
}
