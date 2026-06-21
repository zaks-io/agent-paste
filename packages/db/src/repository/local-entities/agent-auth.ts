import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

function delegationKey(input: { providerIssuer: string; providerSubject: string; audience: string }): string {
  return `${input.providerIssuer}\n${input.providerSubject}\n${input.audience}`;
}

export function localAgentAuth(state: LocalState): Entities["agentAuth"] {
  const findActiveDelegation = (input: { providerIssuer: string; providerSubject: string; audience: string }) => {
    const key = delegationKey(input);
    return (
      [...state.agentAuthDelegations.values()].find(
        (delegation) =>
          delegation.revoked_at === null &&
          delegationKey({
            providerIssuer: delegation.provider_issuer,
            providerSubject: delegation.provider_subject,
            audience: delegation.audience,
          }) === key,
      ) ?? null
    );
  };
  return {
    async insertDelegation(delegation) {
      state.agentAuthDelegations.set(delegation.id, delegation);
    },
    async findActiveDelegation(input) {
      return findActiveDelegation(input);
    },
    async findDelegationById(id) {
      return state.agentAuthDelegations.get(id) ?? null;
    },
    async updateDelegationSeen(id, input) {
      const delegation = state.agentAuthDelegations.get(id);
      if (delegation) {
        delegation.email = input.email;
        delegation.last_seen_at = input.lastSeenAt;
      }
    },
    async revokeActiveDelegation(input) {
      const delegation = findActiveDelegation(input);
      if (!delegation) {
        return null;
      }
      delegation.revoked_at = input.revokedAt;
      return delegation;
    },
    async insertRegistration(registration) {
      state.agentAuthRegistrations.set(registration.id, registration);
    },
    async findRegistrationById(id) {
      return state.agentAuthRegistrations.get(id) ?? null;
    },
    async findRegistrationByClaimTokenHash(claimTokenHash) {
      return (
        [...state.agentAuthRegistrations.values()].find((registration) =>
          bytesEqual(registration.claim_token_hash, claimTokenHash),
        ) ?? null
      );
    },
    async findRegistrationByClaimAttemptTokenHash(claimAttemptTokenHash) {
      return (
        [...state.agentAuthRegistrations.values()].find((registration) =>
          bytesEqual(registration.claim_attempt_token_hash, claimAttemptTokenHash),
        ) ?? null
      );
    },
    async markRegistrationVerified(id, input) {
      const registration = state.agentAuthRegistrations.get(id);
      if (!registration) {
        return null;
      }
      registration.delegation_id = input.delegationId;
      registration.status = "verified";
      registration.completed_at = input.completedAt;
      registration.updated_at = input.updatedAt;
      return registration;
    },
    async markAnonymousClaimPending(id, input) {
      const registration = state.agentAuthRegistrations.get(id);
      if (!registration) {
        return null;
      }
      registration.status = "anonymous_claim_pending";
      registration.claim_attempt_token_hash = input.claimAttemptTokenHash;
      registration.user_code_hash = input.userCodeHash;
      registration.claim_attempt_expires_at = input.claimAttemptExpiresAt;
      registration.updated_at = input.updatedAt;
      return registration;
    },
    async markAnonymousRegistrationVerified(id, input) {
      const registration = state.agentAuthRegistrations.get(id);
      if (!registration) {
        return null;
      }
      registration.workspace_id = input.workspaceId;
      registration.workspace_member_id = input.workspaceMemberId;
      registration.email = input.email;
      registration.status = "verified";
      registration.completed_at = input.completedAt;
      registration.updated_at = input.updatedAt;
      return registration;
    },
    async insertJti(jti) {
      const key = `${jti.provider_issuer}\n${jti.jti}`;
      if (state.agentAuthJtis.has(key)) {
        return false;
      }
      state.agentAuthJtis.set(key, jti);
      return true;
    },
    async insertAccessToken(accessToken) {
      state.agentAuthAccessTokens.set(accessToken.api_key_id, accessToken);
    },
    async findAccessTokenByApiKeyId(apiKeyId) {
      return state.agentAuthAccessTokens.get(apiKeyId) ?? null;
    },
    async listAccessTokensForDelegation(delegationId) {
      return [...state.agentAuthAccessTokens.values()].filter(
        (accessToken) => accessToken.delegation_id === delegationId,
      );
    },
  };
}

function bytesEqual(left: Uint8Array | null, right: Uint8Array): boolean {
  if (!left || left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}
