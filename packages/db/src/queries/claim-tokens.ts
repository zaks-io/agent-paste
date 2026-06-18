import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { defineSqlQuerySourceMap } from "../postgres/query-source.js";
import { claimTokens } from "../schema.js";
import type { ClaimToken } from "../types.js";

export const claimTokenQueries = defineSqlQuerySourceMap(
  "packages/db/src/queries/claim-tokens.ts",
  "claimTokenQueries",
  {
    async insert(db: DrizzleDb, row: ClaimToken) {
      await db.insert(claimTokens).values({
        id: row.id,
        workspaceId: row.workspace_id,
        publicId: row.public_id,
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

    async findByPublicId(db: DrizzleDb, publicId: string): Promise<ClaimToken | null> {
      const rows = await db.select().from(claimTokens).where(eq(claimTokens.publicId, publicId)).limit(1);
      const row = rows[0];
      return row ? mapClaimToken(row) : null;
    },

    async markRedeemed(db: DrizzleDb, id: string, redeemedAt: string): Promise<boolean> {
      const rows = await db
        .update(claimTokens)
        .set({ redeemedAt: new Date(redeemedAt) })
        .where(and(eq(claimTokens.id, id), isNull(claimTokens.redeemedAt)))
        .returning({ id: claimTokens.id });
      return rows.length > 0;
    },
  },
);

function mapClaimToken(row: typeof claimTokens.$inferSelect): ClaimToken {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    public_id: row.publicId ?? "",
    token_hash: row.tokenHash,
    pepper_kid: row.pepperKid,
    expires_at: row.expiresAt.toISOString(),
    redeemed_at: row.redeemedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}
