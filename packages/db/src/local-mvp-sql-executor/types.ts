import type { LocalState } from "../repository/local-state.js";
import type { SqlQueryResult, SqlValue } from "../types.js";

export type IdempotencyRecord = {
  workspace_id: string | null;
  actor_type: string;
  actor_id: string;
  operation: string;
  idempotency_key: string;
  status: "in_flight" | "completed";
  result_json: unknown | null;
  created_at: string;
  completed_at: string | null;
};

export type HandlerContext = {
  state: LocalState;
  idempotencyRecords: Map<string, IdempotencyRecord>;
};

export type StatementHandler = <Row = Record<string, unknown>>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
) => SqlQueryResult<Row> | null;
