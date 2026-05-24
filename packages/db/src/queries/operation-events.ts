import { and, asc, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { createId } from "../id.js";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { operationEvents } from "../schema.js";
import type { OperationEvent } from "../types.js";

export const operationEventQueries = {
  async insert(
    db: DrizzleDb,
    input: {
      actorType: "api_key" | "member" | "admin" | "system";
      actorId: string | null;
      action: string;
      targetType: string;
      targetId: string;
      workspaceId: string | null;
      details: Record<string, unknown>;
      occurredAt: string;
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
      requestId: null,
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
    const conditions: SQL[] = [eq(operationEvents.workspaceId, input.workspaceId)];
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
};

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
