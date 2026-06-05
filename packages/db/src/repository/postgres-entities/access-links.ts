import { accessLinkQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresAccessLinks(ctx: PostgresContext): Entities["accessLinks"] {
  const { drizzle } = ctx;
  return {
    insert: (link) => accessLinkQueries.insert(drizzle, link),
    findById: (id, workspaceId) => accessLinkQueries.findById(drizzle, id, workspaceId),
    findByPublicId: (publicId) => accessLinkQueries.findByPublicId(drizzle, publicId),
    listForArtifact: (artifactId) => accessLinkQueries.listForArtifact(drizzle, artifactId),
    listForWorkspace: (workspaceId) => accessLinkQueries.listForWorkspace(drizzle, workspaceId),
    revoke: (id, revokedAt) => accessLinkQueries.revoke(drizzle, id, revokedAt),
    updateExpiresAt: (id, expiresAt) => accessLinkQueries.updateExpiresAt(drizzle, id, expiresAt),
  };
}
