import { uploadSessionFileQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresUploadSessionFiles(ctx: PostgresContext): Entities["uploadSessionFiles"] {
  const { drizzle } = ctx;
  return {
    insert: (sessionId, file) => uploadSessionFileQueries.insert(drizzle, sessionId, file),
    insertMany: (sessionId, files) => uploadSessionFileQueries.insertMany(drizzle, sessionId, files),
    listForSession: (sessionId) => uploadSessionFileQueries.listForSession(drizzle, sessionId),
    recordUpload: (input) => uploadSessionFileQueries.recordUpload(drizzle, input),
  };
}
