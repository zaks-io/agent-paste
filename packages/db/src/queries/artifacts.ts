import { and, asc, desc, eq, type SQL } from "drizzle-orm";
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

  async listForArtifact(db: DrizzleDb, artifactId: string): Promise<StoredFile[]> {
    const rows = await db
      .select()
      .from(artifactFiles)
      .where(eq(artifactFiles.artifactId, artifactId))
      .orderBy(asc(artifactFiles.path));
    return rows.map(mapArtifactFile);
  },
};

function mapArtifact(row: typeof artifacts.$inferSelect): Artifact {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    revision_id: row.revisionId,
    status: row.status as Artifact["status"],
    title: row.title,
    entrypoint: row.entrypoint,
    file_count: row.fileCount,
    size_bytes: Number(row.sizeBytes),
    expires_at: row.expiresAt.toISOString(),
    created_by_api_key_id: row.createdByApiKeyId,
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
