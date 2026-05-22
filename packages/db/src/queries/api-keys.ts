import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { apiKeys } from "../schema.js";
import type { ApiKey } from "../types.js";

export const apiKeyQueries = {
  async insert(db: DrizzleDb, row: ApiKey) {
    await db.insert(apiKeys).values({
      id: row.id,
      workspaceId: row.workspace_id,
      publicId: row.public_id,
      name: row.name,
      secretHmac: row.secret_hmac,
      pepperKid: row.pepper_kid,
      scopes: row.scopes,
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
      createdAt: new Date(row.created_at),
    });
  },

  async findById(db: DrizzleDb, id: string): Promise<ApiKey | null> {
    const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    const row = rows[0];
    return row ? mapApiKey(row) : null;
  },

  async findByPublicId(db: DrizzleDb, publicId: string): Promise<ApiKey | null> {
    const rows = await db.select().from(apiKeys).where(eq(apiKeys.publicId, publicId)).limit(1);
    const row = rows[0];
    return row ? mapApiKey(row) : null;
  },

  async updateLastUsedAt(db: DrizzleDb, id: string, lastUsedAt: string) {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date(lastUsedAt) })
      .where(eq(apiKeys.id, id));
  },

  async updateRevokedAt(db: DrizzleDb, id: string, revokedAt: string) {
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date(revokedAt) })
      .where(eq(apiKeys.id, id));
  },
};

function mapApiKey(row: typeof apiKeys.$inferSelect): ApiKey {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    public_id: row.publicId,
    name: row.name,
    secret_hmac: row.secretHmac,
    pepper_kid: row.pepperKid,
    scopes: row.scopes,
    revoked_at: row.revokedAt ? row.revokedAt.toISOString() : null,
    last_used_at: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
  };
}
