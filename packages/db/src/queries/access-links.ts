import { and, desc, eq, isNull } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { accessLinks } from "../schema.js";
import type { AccessLink } from "../types.js";

export const accessLinkQueries = {
  async insert(db: DrizzleDb, row: AccessLink) {
    await db.insert(accessLinks).values({
      id: row.id,
      workspaceId: row.workspace_id,
      artifactId: row.artifact_id,
      revisionId: row.revision_id,
      publicId: row.public_id,
      type: row.type,
      scopesBitmask: row.scopes_bitmask,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      createdByType: row.created_by_type,
      createdById: row.created_by_id,
      createdAt: new Date(row.created_at),
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    });
  },

  async findById(db: DrizzleDb, id: string, workspaceId?: string): Promise<AccessLink | null> {
    const predicate = workspaceId
      ? and(eq(accessLinks.id, id), eq(accessLinks.workspaceId, workspaceId))
      : eq(accessLinks.id, id);
    const rows = await db.select().from(accessLinks).where(predicate).limit(1);
    const row = rows[0];
    return row ? mapAccessLink(row) : null;
  },

  async findByPublicId(db: DrizzleDb, publicId: string): Promise<AccessLink | null> {
    const rows = await db.select().from(accessLinks).where(eq(accessLinks.publicId, publicId)).limit(1);
    const row = rows[0];
    return row ? mapAccessLink(row) : null;
  },

  async listForArtifact(db: DrizzleDb, artifactId: string): Promise<AccessLink[]> {
    const rows = await db
      .select()
      .from(accessLinks)
      .where(eq(accessLinks.artifactId, artifactId))
      .orderBy(desc(accessLinks.createdAt));
    return rows.map(mapAccessLink);
  },

  async revoke(db: DrizzleDb, id: string, revokedAt: string): Promise<boolean> {
    const rows = await db
      .update(accessLinks)
      .set({ revokedAt: new Date(revokedAt) })
      .where(and(eq(accessLinks.id, id), isNull(accessLinks.revokedAt)))
      .returning({ id: accessLinks.id });
    return rows.length > 0;
  },

  async updateExpiresAt(db: DrizzleDb, id: string, expiresAt: string | null): Promise<boolean> {
    const rows = await db
      .update(accessLinks)
      .set({ expiresAt: expiresAt ? new Date(expiresAt) : null })
      .where(eq(accessLinks.id, id))
      .returning({ id: accessLinks.id });
    return rows.length > 0;
  },
};

function mapAccessLink(row: typeof accessLinks.$inferSelect): AccessLink {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    artifact_id: row.artifactId,
    revision_id: row.revisionId ?? null,
    public_id: row.publicId,
    type: row.type as AccessLink["type"],
    scopes_bitmask: row.scopesBitmask,
    expires_at: row.expiresAt ? row.expiresAt.toISOString() : null,
    created_by_type: row.createdByType as AccessLink["created_by_type"],
    created_by_id: row.createdById,
    created_at: row.createdAt.toISOString(),
    revoked_at: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}
