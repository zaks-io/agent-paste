import { workspaceQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresWorkspaces(ctx: PostgresContext): Entities["workspaces"] {
  const { drizzle } = ctx;
  return {
    insert: (workspace) => workspaceQueries.insert(drizzle, workspace),
    findById: (id) => workspaceQueries.findById(drizzle, id),
    listAll: () => workspaceQueries.listAll(drizzle),
    update: (id, input) => workspaceQueries.update(drizzle, id, input),
    markClaimed: (id, input) => workspaceQueries.markClaimed(drizzle, id, input),
  };
}
