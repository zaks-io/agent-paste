import type { OperationEvent, SafetyWarning, SqlValue } from "../types.js";
import type { IdempotencyRecord } from "./types.js";

export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

export function idempotencyKey(record: {
  workspaceId: string | null;
  actorType: string;
  actorId: string;
  operation: string;
  idempotencyKey: string;
}): string {
  return [record.workspaceId ?? "", record.actorType, record.actorId, record.operation, record.idempotencyKey].join(
    "\0",
  );
}

export function idempotencyKeyFromParams(params: readonly SqlValue[]): string {
  const workspaceId = params[0] === null || params[0] === undefined ? null : String(params[0]);
  return idempotencyKey({
    workspaceId,
    actorType: String(params[1]),
    actorId: String(params[2]),
    operation: String(params[3]),
    idempotencyKey: String(params[4]),
  });
}

export function parseIdempotencyInsert(params: readonly SqlValue[]): IdempotencyRecord | null {
  if (params.length < 6) {
    return null;
  }
  return {
    workspace_id: params[0] === null ? null : String(params[0]),
    actor_type: String(params[1]),
    actor_id: String(params[2]),
    operation: String(params[3]),
    idempotency_key: String(params[4]),
    status: "in_flight",
    result_json: null,
    created_at: String(params[5]),
    completed_at: null,
  };
}

export function parseSafetyWarningInsert(params: readonly SqlValue[]): SafetyWarning | null {
  if (params.length < 12) {
    return null;
  }
  return {
    id: String(params[0]),
    workspace_id: String(params[1]),
    artifact_id: String(params[2]),
    revision_id: String(params[3]),
    scanner_id: String(params[4]),
    scanner_version: String(params[5]),
    code: String(params[6]),
    severity: String(params[7]) as SafetyWarning["severity"],
    scope: String(params[8]) as SafetyWarning["scope"],
    file_path: params[9] === null ? null : String(params[9]),
    message: String(params[10]),
    created_at: String(params[11]),
  };
}

export function parseOperationEventInsert(params: readonly SqlValue[]): OperationEvent | null {
  if (params.length < 10) {
    return null;
  }
  return {
    id: String(params[0]),
    workspace_id: params[1] === null ? null : String(params[1]),
    actor_type: String(params[2]) as OperationEvent["actor_type"],
    actor_id: params[3] === null ? null : String(params[3]),
    action: String(params[4]),
    target_type: String(params[5]),
    target_id: String(params[6]),
    details:
      typeof params[7] === "string"
        ? (JSON.parse(params[7]) as Record<string, unknown>)
        : params[7] && typeof params[7] === "object" && !Array.isArray(params[7])
          ? (params[7] as Record<string, unknown>)
          : {},
    request_id: params[8] === null ? null : String(params[8]),
    occurred_at: String(params[9]),
  };
}
