import { and, desc, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { revisions } from "../schema.js";
import type { PublishBundleStatus, Revision } from "../types.js";

export const revisionQueries = {
  async insert(db: DrizzleDb, row: Revision) {
    await db.insert(revisions).values({
      id: row.id,
      workspaceId: row.workspace_id,
      artifactId: row.artifact_id,
      revisionNumber: row.revision_number,
      status: row.status,
      entrypoint: row.entrypoint,
      renderMode: row.render_mode,
      fileCount: row.file_count,
      sizeBytes: row.size_bytes,
      bundleStatus: row.bundle_status,
      bundleStatusUpdatedAt: row.bundle_status_updated_at ? new Date(row.bundle_status_updated_at) : null,
      bundleSizeBytes: row.bundle_size_bytes,
      bytesPurgeEnqueuedAt: row.bytes_purge_enqueued_at ? new Date(row.bytes_purge_enqueued_at) : null,
      createdByApiKeyId: row.created_by_api_key_id,
      createdAt: new Date(row.created_at),
      publishedAt: row.published_at ? new Date(row.published_at) : null,
    });
  },

  async findById(db: DrizzleDb, revisionId: string, workspaceId?: string): Promise<Revision | null> {
    const predicate = workspaceId
      ? and(eq(revisions.id, revisionId), eq(revisions.workspaceId, workspaceId))
      : eq(revisions.id, revisionId);
    const rows = await db.select().from(revisions).where(predicate).limit(1);
    const row = rows[0];
    return row ? mapRevision(row) : null;
  },

  async findDraftForArtifact(db: DrizzleDb, artifactId: string): Promise<Revision | null> {
    const rows = await db
      .select()
      .from(revisions)
      .where(and(eq(revisions.artifactId, artifactId), eq(revisions.status, "draft")))
      .limit(1);
    const row = rows[0];
    return row ? mapRevision(row) : null;
  },

  async listForArtifact(db: DrizzleDb, artifactId: string): Promise<Revision[]> {
    const rows = await db
      .select()
      .from(revisions)
      .where(eq(revisions.artifactId, artifactId))
      .orderBy(desc(revisions.revisionNumber), desc(revisions.createdAt));
    return rows.map(mapRevision);
  },

  async nextRevisionNumber(db: DrizzleDb, artifactId: string): Promise<number> {
    const rows = await db
      .select({ max: sql<number>`coalesce(max(${revisions.revisionNumber}), 0)` })
      .from(revisions)
      .where(and(eq(revisions.artifactId, artifactId), eq(revisions.status, "published")));
    return Number(rows[0]?.max ?? 0) + 1;
  },

  async publish(
    db: DrizzleDb,
    input: {
      revisionId: string;
      revisionNumber: number;
      publishedAt: string;
      bundleStatus: PublishBundleStatus;
    },
  ): Promise<boolean> {
    const rows = await db
      .update(revisions)
      .set({
        status: "published",
        revisionNumber: input.revisionNumber,
        publishedAt: new Date(input.publishedAt),
        bundleStatus: input.bundleStatus,
        bundleStatusUpdatedAt: new Date(input.publishedAt),
        bundleSizeBytes: null,
      })
      .where(and(eq(revisions.id, input.revisionId), eq(revisions.status, "draft")))
      .returning({ id: revisions.id });
    return rows.length > 0;
  },
};

function mapRevision(row: typeof revisions.$inferSelect): Revision {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    artifact_id: row.artifactId,
    revision_number: row.revisionNumber,
    status: row.status as Revision["status"],
    entrypoint: row.entrypoint,
    render_mode: row.renderMode as Revision["render_mode"],
    file_count: row.fileCount,
    size_bytes: Number(row.sizeBytes),
    bundle_status: row.bundleStatus as Revision["bundle_status"],
    bundle_status_updated_at: row.bundleStatusUpdatedAt ? row.bundleStatusUpdatedAt.toISOString() : null,
    bundle_size_bytes: row.bundleSizeBytes ?? null,
    bytes_purge_enqueued_at: row.bytesPurgeEnqueuedAt ? row.bytesPurgeEnqueuedAt.toISOString() : null,
    created_by_api_key_id: row.createdByApiKeyId,
    created_at: row.createdAt.toISOString(),
    published_at: row.publishedAt ? row.publishedAt.toISOString() : null,
  };
}

export function toRevisionSummary(revision: Revision) {
  return {
    revision_id: revision.id,
    revision_number: revision.revision_number,
    status: revision.status,
    entrypoint: revision.entrypoint,
    render_mode: revision.render_mode,
    file_count: revision.file_count,
    size_bytes: revision.size_bytes,
    created_at: revision.created_at,
    published_at: revision.published_at,
  };
}
