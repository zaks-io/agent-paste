import type { SqlQueryResult, SqlValue } from "../types.js";
import { idempotencyKey, idempotencyKeyFromParams, parseIdempotencyInsert } from "./shared.js";
import type { HandlerContext } from "./types.js";

export function handleIdempotencyInsert<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.startsWith("insert into idempotency_records")) {
    return null;
  }
  const record = parseIdempotencyInsert(params);
  if (!record) {
    return { rows: [] as Row[] };
  }
  const key = idempotencyKey({
    workspaceId: record.workspace_id,
    actorType: record.actor_type,
    actorId: record.actor_id,
    operation: record.operation,
    idempotencyKey: record.idempotency_key,
  });
  if (context.idempotencyRecords.has(key)) {
    return { rows: [] as Row[] };
  }
  context.idempotencyRecords.set(key, record);
  return { rows: [{ workspace_id: record.workspace_id }] as Row[] };
}

export function handleIdempotencySelectForUpdate<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.includes("from idempotency_records") || !normalized.includes("for update")) {
    return null;
  }
  const record = context.idempotencyRecords.get(idempotencyKeyFromParams(params));
  if (!record) {
    return { rows: [] as Row[] };
  }
  return {
    rows: [
      {
        status: record.status,
        result_json: record.result_json,
        created_at: record.created_at,
      },
    ] as Row[],
  };
}

export function handleIdempotencyUpdateInFlight<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.startsWith("update idempotency_records") || !normalized.includes("status = 'in_flight'")) {
    return null;
  }
  const record = context.idempotencyRecords.get(idempotencyKeyFromParams(params));
  if (record) {
    record.status = "in_flight";
    record.result_json = null;
    record.completed_at = null;
    record.created_at = String(params[5]);
  }
  return { rows: [] as Row[] };
}

export function handleIdempotencyUpdateCompleted<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.startsWith("update idempotency_records") || !normalized.includes("status = 'completed'")) {
    return null;
  }
  const record = context.idempotencyRecords.get(idempotencyKeyFromParams(params));
  if (record) {
    record.status = "completed";
    record.result_json = typeof params[5] === "string" ? JSON.parse(params[5]) : params[5];
    record.completed_at = String(params[6]);
  }
  return { rows: [] as Row[] };
}
