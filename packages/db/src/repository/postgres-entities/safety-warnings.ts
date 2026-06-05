import { safetyWarningQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresSafetyWarnings(ctx: PostgresContext): Entities["safetyWarnings"] {
  const { drizzle } = ctx;
  return {
    listForRevision: (workspaceId, revisionId) =>
      safetyWarningQueries.listForRevision(drizzle, workspaceId, revisionId),
  };
}
