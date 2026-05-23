import { asc, desc, eq } from "drizzle-orm";
import { createId } from "../id.js";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { operationEvents } from "../schema.js";
import type { OperationEvent } from "../types.js";

export const operationEventQueries = {
  async insert(
    db: DrizzleDb,
    input: {
      actorType: "api_key" | "admin" | "system";
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
      .map(
        (row): OperationEvent => ({
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
        }),
      )
      .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
  },

  async listForWorkspace(db: DrizzleDb, workspaceId: string): Promise<OperationEvent[]> {
    const rows = await db
      .select()
      .from(operationEvents)
      .where(eq(operationEvents.workspaceId, workspaceId))
      .orderBy(desc(operationEvents.occurredAt));
    return rows.map(
      (row): OperationEvent => ({
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
      }),
    );
  },
};
