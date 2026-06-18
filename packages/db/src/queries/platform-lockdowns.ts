import { and, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { defineSqlQuerySourceMap } from "../postgres/query-source.js";
import type { LockdownCursor } from "../repository/web-transforms.js";
import { platformLockdowns } from "../schema.js";
import type { PlatformLockdown } from "../types.js";

export const platformLockdownQueries = defineSqlQuerySourceMap(
  "packages/db/src/queries/platform-lockdowns.ts",
  "platformLockdownQueries",
  {
    async findEffective(
      db: DrizzleDb,
      scope: PlatformLockdown["scope"],
      targetId: string,
    ): Promise<PlatformLockdown | null> {
      const rows = await db
        .select()
        .from(platformLockdowns)
        .where(
          and(
            eq(platformLockdowns.scope, scope),
            eq(platformLockdowns.targetId, targetId),
            isNull(platformLockdowns.liftedAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row ? mapLockdown(row) : null;
    },

    async listEffectivePage(
      db: DrizzleDb,
      input: { limit: number; cursor?: LockdownCursor },
    ): Promise<PlatformLockdown[]> {
      const conditions: SQL[] = [isNull(platformLockdowns.liftedAt)];
      if (input.cursor) {
        const cursorPredicate = or(
          lt(platformLockdowns.setAt, input.cursor.setAt),
          and(eq(platformLockdowns.setAt, input.cursor.setAt), lt(platformLockdowns.id, input.cursor.id)),
        ) as SQL;
        conditions.push(cursorPredicate);
      }
      const rows = await db
        .select()
        .from(platformLockdowns)
        .where(and(...conditions))
        .orderBy(desc(platformLockdowns.setAt), desc(platformLockdowns.id))
        .limit(input.limit);
      return rows.map(mapLockdown);
    },

    async insert(db: DrizzleDb, row: PlatformLockdown): Promise<boolean> {
      const inserted = await db
        .insert(platformLockdowns)
        .values({
          id: row.id,
          scope: row.scope,
          targetId: row.target_id,
          reasonCode: row.reason_code,
          setAt: new Date(row.set_at),
          setBy: row.set_by,
          liftedAt: row.lifted_at ? new Date(row.lifted_at) : null,
          liftedBy: row.lifted_by,
        })
        .onConflictDoNothing()
        .returning({ id: platformLockdowns.id });
      return inserted.length > 0;
    },

    async markLifted(db: DrizzleDb, id: string, input: { liftedAt: string; liftedBy: string }): Promise<boolean> {
      const lifted = await db
        .update(platformLockdowns)
        .set({ liftedAt: new Date(input.liftedAt), liftedBy: input.liftedBy })
        .where(and(eq(platformLockdowns.id, id), isNull(platformLockdowns.liftedAt)))
        .returning({ id: platformLockdowns.id });
      return lifted.length > 0;
    },
  },
);

function mapLockdown(row: typeof platformLockdowns.$inferSelect): PlatformLockdown {
  return {
    id: row.id,
    scope: row.scope as PlatformLockdown["scope"],
    target_id: row.targetId,
    reason_code: row.reasonCode,
    set_at: row.setAt.toISOString(),
    set_by: row.setBy,
    lifted_at: row.liftedAt ? row.liftedAt.toISOString() : null,
    lifted_by: row.liftedBy,
  };
}
