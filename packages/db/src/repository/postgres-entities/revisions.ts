import { revisionQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresRevisions(ctx: PostgresContext): Entities["revisions"] {
  const { drizzle } = ctx;
  return {
    insert: (revision) => revisionQueries.insert(drizzle, revision),
    findById: (revisionId, workspaceId) => revisionQueries.findById(drizzle, revisionId, workspaceId),
    findDraftForArtifact: (artifactId) => revisionQueries.findDraftForArtifact(drizzle, artifactId),
    listForArtifact: (artifactId) => revisionQueries.listForArtifact(drizzle, artifactId),
    nextRevisionNumber: (artifactId) => revisionQueries.nextRevisionNumber(drizzle, artifactId),
    publish: (input) => revisionQueries.publish(drizzle, input),
    markRetained: (input) => revisionQueries.markRetained(drizzle, input),
  };
}
