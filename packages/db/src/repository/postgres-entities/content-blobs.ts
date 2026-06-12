import { contentBlobQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresContentBlobs(ctx: PostgresContext): Entities["contentBlobs"] {
  const { drizzle } = ctx;
  return {
    find: (input) => contentBlobQueries.find(drizzle, input),
    upsert: (blob) => contentBlobQueries.upsert(drizzle, blob),
    deleteUnreferenced: (input) => contentBlobQueries.deleteUnreferenced(drizzle, input),
    listForReparent: (workspaceId) => contentBlobQueries.listForReparent(drizzle, workspaceId),
  };
}
