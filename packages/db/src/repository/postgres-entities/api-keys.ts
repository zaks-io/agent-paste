import { apiKeyQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresApiKeys(ctx: PostgresContext): Entities["apiKeys"] {
  const { drizzle } = ctx;
  return {
    insert: (apiKey) => apiKeyQueries.insert(drizzle, apiKey),
    findById: (id) => apiKeyQueries.findById(drizzle, id),
    findByPublicId: (publicId) => apiKeyQueries.findByPublicId(drizzle, publicId),
    listForWorkspace: (workspaceId) => apiKeyQueries.listForWorkspace(drizzle, workspaceId),
    updateLastUsedAt: (id, lastUsedAt) => apiKeyQueries.updateLastUsedAt(drizzle, id, lastUsedAt),
    updateRevokedAt: (id, revokedAt) => apiKeyQueries.updateRevokedAt(drizzle, id, revokedAt),
    revokeAllForWorkspace: (workspaceId, revokedAt) =>
      apiKeyQueries.revokeAllForWorkspace(drizzle, workspaceId, revokedAt),
  };
}
