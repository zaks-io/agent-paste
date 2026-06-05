import type { SqlQueryResult, SqlValue } from "../types.js";
import { parseOperationEventInsert } from "./shared.js";
import type { HandlerContext } from "./types.js";

export function handleOperationEventsInsert<Row>(
  normalized: string,
  params: readonly SqlValue[],
  context: HandlerContext,
): SqlQueryResult<Row> | null {
  if (!normalized.startsWith("insert into operation_events")) {
    return null;
  }
  const event = parseOperationEventInsert(params);
  if (event) {
    context.state.operationEvents.set(event.id, event);
  }
  return { rows: [] as Row[] };
}
