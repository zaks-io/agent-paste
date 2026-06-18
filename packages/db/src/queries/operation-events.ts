import { and, asc, desc, eq, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import { TENANT_AUDIT_ACTOR_TYPES } from "../audit/change-summary.js";
import { createId } from "../id.js";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { defineSqlQuerySourceMap } from "../postgres/query-source.js";
import { operationEvents } from "../schema.js";
import type { OperationEvent } from "../types.js";

export const operationEventQueries = defineSqlQuerySourceMap(
  "packages/db/src/queries/operation-events.ts",
  "operationEventQueries",
  {
    async insert(
      db: DrizzleDb,
      input: {
        actorType: "api_key" | "member" | "admin" | "system" | "platform";
        actorId: string | null;
        action: string;
        targetType: string;
        targetId: string;
        workspaceId: string | null;
        details: Record<string, unknown>;
        occurredAt: string;
        requestId?: string | null;
      },
    ) {
      await db.insert(operationEvents).values({
        id: createId("evt"),
        workspaceId: input.workspaceId,
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        details: input.details,
        requestId: input.requestId ?? null,
        occurredAt: new Date(input.occurredAt),
      });
    },

    async listIdsForTarget(db: DrizzleDb, targetId: string): Promise<string[]> {
      const rows = await db
        .select({ id: operationEvents.id })
        .from(operationEvents)
        .where(eq(operationEvents.targetId, targetId))
        .orderBy(asc(operationEvents.occurredAt));
      return rows.map((row) => row.id);
    },

    async listAll(db: DrizzleDb): Promise<OperationEvent[]> {
      const rows = await db.select().from(operationEvents);
      return rows
        .map((row) => mapOperationEvent(row))
        .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
    },

    async listForWorkspace(db: DrizzleDb, workspaceId: string): Promise<OperationEvent[]> {
      const rows = await db
        .select()
        .from(operationEvents)
        .where(eq(operationEvents.workspaceId, workspaceId))
        .orderBy(desc(operationEvents.occurredAt));
      return rows.map((row) => mapOperationEvent(row));
    },

    async listWebPage(
      db: DrizzleDb,
      input: { workspaceId: string; limit: number; cursor?: OperationEventCursor },
    ): Promise<OperationEvent[]> {
      const conditions: SQL[] = [
        eq(operationEvents.workspaceId, input.workspaceId),
        // Internal system/platform events stay on the operator surface only.
        inArray(operationEvents.actorType, [...TENANT_AUDIT_ACTOR_TYPES]),
      ];
      if (input.cursor) {
        const cursorPredicate = or(
          lt(operationEvents.occurredAt, input.cursor.occurredAt),
          and(eq(operationEvents.occurredAt, input.cursor.occurredAt), lt(operationEvents.id, input.cursor.id)),
        ) as SQL;
        conditions.push(cursorPredicate);
      }
      const rows = await db
        .select()
        .from(operationEvents)
        .where(and(...conditions))
        .orderBy(desc(operationEvents.occurredAt), desc(operationEvents.id))
        .limit(input.limit);
      return rows.map((row) => mapOperationEvent(row));
    },

    async listOperatorPage(
      db: DrizzleDb,
      input: {
        limit: number;
        cursor?: OperationEventCursor;
        workspaceId?: string;
        actorType?: string;
        action?: string;
        targetType?: string;
        requestId?: string;
        actions?: string[];
      },
    ): Promise<OperationEvent[]> {
      const conditions: SQL[] = [];
      if (input.workspaceId) {
        conditions.push(eq(operationEvents.workspaceId, input.workspaceId));
      }
      if (input.actorType) {
        conditions.push(eq(operationEvents.actorType, input.actorType));
      }
      if (input.targetType) {
        conditions.push(eq(operationEvents.targetType, input.targetType));
      }
      if (input.requestId) {
        conditions.push(eq(operationEvents.requestId, input.requestId));
      }
      if (input.actions !== undefined) {
        conditions.push(input.actions.length === 0 ? sql`false` : inArray(operationEvents.action, input.actions));
      }
      if (input.cursor) {
        const cursorPredicate = or(
          lt(operationEvents.occurredAt, input.cursor.occurredAt),
          and(eq(operationEvents.occurredAt, input.cursor.occurredAt), lt(operationEvents.id, input.cursor.id)),
        ) as SQL;
        conditions.push(cursorPredicate);
      }
      const rows = await db
        .select()
        .from(operationEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(operationEvents.occurredAt), desc(operationEvents.id))
        .limit(input.limit);
      return rows.map((row) => mapOperationEvent(row));
    },
  },
);

export type OperationEventCursor = {
  occurredAt: Date;
  id: string;
};

function mapOperationEvent(row: typeof operationEvents.$inferSelect): OperationEvent {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    actor_type: row.actorType as OperationEvent["actor_type"],
    actor_id: row.actorId,
    action: row.action,
    target_type: row.targetType,
    target_id: row.targetId,
    details: row.details,
    request_id: row.requestId,
    occurred_at: row.occurredAt.toISOString(),
  };
}
