import { contentBlobQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresContentBlobs(ctx: PostgresContext): Entities["contentBlobs"] {
  const { drizzle } = ctx;
  return {
    find: (input) => contentBlobQueries.find(drizzle, input),
    findReusableAndTouch: (workspaceId, files, updatedAt) =>
      contentBlobQueries.findReusableAndTouch(drizzle, workspaceId, files, updatedAt),
    upsert: (blob) => contentBlobQueries.upsert(drizzle, blob),
    upsertMany: (blobs) => contentBlobQueries.upsertMany(drizzle, blobs),
    deleteUnreferenced: (input) => contentBlobQueries.deleteUnreferenced(drizzle, input),
    listForReparent: (workspaceId, now) => contentBlobQueries.listForReparent(drizzle, workspaceId, now),
  };
}
