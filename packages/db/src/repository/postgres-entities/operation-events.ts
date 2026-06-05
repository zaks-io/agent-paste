import { operationEventQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresOperationEvents(ctx: PostgresContext): Entities["operationEvents"] {
  const { drizzle } = ctx;
  return {
    insert: (input) => operationEventQueries.insert(drizzle, input),
    listAll: () => operationEventQueries.listAll(drizzle),
    listForWorkspace: (workspaceId) => operationEventQueries.listForWorkspace(drizzle, workspaceId),
    listWebPage: (input) => operationEventQueries.listWebPage(drizzle, input),
    listOperatorPage: (input) => operationEventQueries.listOperatorPage(drizzle, input),
    listIdsForTarget: (targetId) => operationEventQueries.listIdsForTarget(drizzle, targetId),
  };
}
