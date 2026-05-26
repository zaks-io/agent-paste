import { and, asc, eq } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { uploadSessionFiles, uploadSessions } from "../schema.js";
import type { StoredFile, UploadSession } from "../types.js";

export const uploadSessionQueries = {
  async insert(db: DrizzleDb, row: UploadSession) {
    await db.insert(uploadSessions).values({
      id: row.id,
      workspaceId: row.workspace_id,
      artifactId: row.artifact_id,
      revisionId: row.revision_id,
      status: row.status,
      title: row.title,
      entrypoint: row.entrypoint,
      artifactExpiresAt: new Date(row.artifact_expires_at),
      fileCount: row.file_count,
      sizeBytes: row.size_bytes,
      createdByApiKeyId: row.created_by_api_key_id,
      expiresAt: new Date(row.expires_at),
      createdAt: new Date(row.created_at),
      finalizedAt: row.finalized_at ? new Date(row.finalized_at) : null,
    });
  },

  async findById(db: DrizzleDb, sessionId: string, workspaceId?: string): Promise<UploadSession | null> {
    const predicate = workspaceId
      ? and(eq(uploadSessions.id, sessionId), eq(uploadSessions.workspaceId, workspaceId))
      : eq(uploadSessions.id, sessionId);
    const rows = await db.select().from(uploadSessions).where(predicate).limit(1);
    const row = rows[0];
    return row ? mapUploadSession(row) : null;
  },

  async findByRevisionId(db: DrizzleDb, revisionId: string, workspaceId?: string): Promise<UploadSession | null> {
    const predicate = workspaceId
      ? and(eq(uploadSessions.revisionId, revisionId), eq(uploadSessions.workspaceId, workspaceId))
      : eq(uploadSessions.revisionId, revisionId);
    const rows = await db.select().from(uploadSessions).where(predicate).limit(1);
    const row = rows[0];
    return row ? mapUploadSession(row) : null;
  },

  async markFinalized(db: DrizzleDb, sessionId: string, finalizedAt: string) {
    await db
      .update(uploadSessions)
      .set({ status: "finalized", finalizedAt: new Date(finalizedAt) })
      .where(eq(uploadSessions.id, sessionId));
  },
};

export const uploadSessionFileQueries = {
  async insert(db: DrizzleDb, sessionId: string, file: StoredFile) {
    await db.insert(uploadSessionFiles).values({
      workspaceId: file.workspace_id,
      uploadSessionId: sessionId,
      path: file.path,
      sizeBytes: file.size_bytes,
      servedContentType: file.content_type,
      r2Key: file.r2_key,
      uploadedAt: file.uploaded_at ? new Date(file.uploaded_at) : null,
      // putUrlExpiresAt is notNull in schema; fall back to "now" rather than producing an Invalid Date.
      putUrlExpiresAt: file.put_url_expires_at ? new Date(file.put_url_expires_at) : new Date(),
    });
  },

  async listForSession(db: DrizzleDb, sessionId: string): Promise<StoredFile[]> {
    const rows = await db
      .select()
      .from(uploadSessionFiles)
      .where(eq(uploadSessionFiles.uploadSessionId, sessionId))
      .orderBy(asc(uploadSessionFiles.path));
    return rows.map(mapUploadSessionFile);
  },

  async recordUpload(
    db: DrizzleDb,
    input: { sessionId: string; path: string; objectKey?: string; sizeBytes?: number; uploadedAt: string },
  ) {
    const conditions = [
      eq(uploadSessionFiles.uploadSessionId, input.sessionId),
      eq(uploadSessionFiles.path, input.path),
    ];
    if (input.objectKey) {
      conditions.push(eq(uploadSessionFiles.r2Key, input.objectKey));
    }
    if (typeof input.sizeBytes === "number") {
      conditions.push(eq(uploadSessionFiles.sizeBytes, input.sizeBytes));
    }
    await db
      .update(uploadSessionFiles)
      .set({ uploadedAt: new Date(input.uploadedAt) })
      .where(and(...conditions));
  },
};

function mapUploadSession(row: typeof uploadSessions.$inferSelect): UploadSession {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    artifact_id: row.artifactId,
    revision_id: row.revisionId,
    status: row.status as UploadSession["status"],
    title: row.title,
    entrypoint: row.entrypoint,
    artifact_expires_at: row.artifactExpiresAt.toISOString(),
    file_count: row.fileCount,
    size_bytes: Number(row.sizeBytes),
    created_by_api_key_id: row.createdByApiKeyId,
    expires_at: row.expiresAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    finalized_at: row.finalizedAt ? row.finalizedAt.toISOString() : null,
  };
}

function mapUploadSessionFile(row: typeof uploadSessionFiles.$inferSelect): StoredFile {
  return {
    workspace_id: row.workspaceId,
    upload_session_id: row.uploadSessionId,
    path: row.path,
    size_bytes: Number(row.sizeBytes),
    content_type: row.servedContentType,
    r2_key: row.r2Key,
    uploaded_at: row.uploadedAt ? row.uploadedAt.toISOString() : null,
    put_url_expires_at: row.putUrlExpiresAt.toISOString(),
  };
}
