import { artifactFileQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresArtifactFiles(ctx: PostgresContext): Entities["artifactFiles"] {
  const { drizzle } = ctx;
  return {
    insert: (artifactId, revisionId, file, fallbackUploadedAt) =>
      artifactFileQueries.insert(drizzle, artifactId, revisionId, file, fallbackUploadedAt),
    listForArtifact: (artifactId, revisionId) => artifactFileQueries.listForArtifact(drizzle, artifactId, revisionId),
  };
}
