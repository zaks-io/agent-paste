import { agentAuthQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresAgentAuth(ctx: PostgresContext): Entities["agentAuth"] {
  const { drizzle } = ctx;
  return {
    insertDelegation: (delegation) => agentAuthQueries.insertDelegation(drizzle, delegation),
    findActiveDelegation: (input) => agentAuthQueries.findActiveDelegation(drizzle, input),
    findDelegationById: (id) => agentAuthQueries.findDelegationById(drizzle, id),
    updateDelegationSeen: (id, input) => agentAuthQueries.updateDelegationSeen(drizzle, id, input),
    revokeActiveDelegation: (input) => agentAuthQueries.revokeActiveDelegation(drizzle, input),
    insertRegistration: (registration) => agentAuthQueries.insertRegistration(drizzle, registration),
    findRegistrationById: (id) => agentAuthQueries.findRegistrationById(drizzle, id),
    findRegistrationByClaimTokenHash: (hash) => agentAuthQueries.findRegistrationByClaimTokenHash(drizzle, hash),
    findRegistrationByClaimAttemptTokenHash: (hash) =>
      agentAuthQueries.findRegistrationByClaimAttemptTokenHash(drizzle, hash),
    markRegistrationVerified: (id, input) => agentAuthQueries.markRegistrationVerified(drizzle, id, input),
    markAnonymousClaimPending: (id, input) => agentAuthQueries.markAnonymousClaimPending(drizzle, id, input),
    markAnonymousRegistrationVerified: (id, input) =>
      agentAuthQueries.markAnonymousRegistrationVerified(drizzle, id, input),
    insertJti: (jti) => agentAuthQueries.insertJti(drizzle, jti),
    insertAccessToken: (accessToken) => agentAuthQueries.insertAccessToken(drizzle, accessToken),
    findAccessTokenByApiKeyId: (apiKeyId) => agentAuthQueries.findAccessTokenByApiKeyId(drizzle, apiKeyId),
    listAccessTokensForDelegation: (delegationId) =>
      agentAuthQueries.listAccessTokensForDelegation(drizzle, delegationId),
  };
}
