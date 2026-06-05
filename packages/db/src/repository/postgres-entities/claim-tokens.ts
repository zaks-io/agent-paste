import { claimTokenQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresClaimTokens(ctx: PostgresContext): Entities["claimTokens"] {
  const { drizzle } = ctx;
  return {
    insert: (claimToken) => claimTokenQueries.insert(drizzle, claimToken),
    findById: (id, workspaceId) => claimTokenQueries.findById(drizzle, id, workspaceId),
    findByPublicId: (publicId) => claimTokenQueries.findByPublicId(drizzle, publicId),
    markRedeemed: (id, redeemedAt) => claimTokenQueries.markRedeemed(drizzle, id, redeemedAt),
  };
}
