import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { claimTokens } from "../schema.js";
import type { ClaimToken } from "../types.js";

export const claimTokenQueries = {
  async insert(db: DrizzleDb, row: ClaimToken) {
    await db.insert(claimTokens).values({
      id: row.id,
      workspaceId: row.workspace_id,
      tokenHash: row.token_hash,
      pepperKid: row.pepper_kid,
      expiresAt: new Date(row.expires_at),
      redeemedAt: row.redeemed_at ? new Date(row.redeemed_at) : null,
      createdAt: new Date(row.created_at),
    });
  },

  async findById(db: DrizzleDb, id: string, workspaceId?: string): Promise<ClaimToken | null> {
    const rows = await db.select().from(claimTokens).where(eq(claimTokens.id, id)).limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    if (workspaceId && row.workspaceId !== workspaceId) {
      return null;
    }
    return mapClaimToken(row);
  },
};

function mapClaimToken(row: typeof claimTokens.$inferSelect): ClaimToken {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    token_hash: row.tokenHash,
    pepper_kid: row.pepperKid,
    expires_at: row.expiresAt.toISOString(),
    redeemed_at: row.redeemedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}
