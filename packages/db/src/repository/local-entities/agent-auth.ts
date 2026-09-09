import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

function delegationKey(input: { providerIssuer: string; providerSubject: string; audience: string }): string {
  return `${input.providerIssuer}\n${input.providerSubject}\n${input.audience}`;
}

function findActiveDelegation(
  state: LocalState,
  input: { providerIssuer: string; providerSubject: string; audience: string },
) {
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
}

function checkAnonymousClaimAttempt(
  state: LocalState,
  input: Parameters<Entities["agentAuth"]["checkAnonymousClaimAttempt"]>[0],
): Awaited<ReturnType<Entities["agentAuth"]["checkAnonymousClaimAttempt"]>> {
  const registration = [...state.agentAuthRegistrations.values()].find((candidate) =>
    bytesEqual(candidate.claim_attempt_token_hash, input.claimAttemptTokenHash),
  );
  if (
    !registration ||
    registration.registration_type !== "anonymous" ||
    !["anonymous_claim_pending", "anonymous_claiming", "verified"].includes(registration.status) ||
    !registration.claim_expires_at ||
    !registration.claim_attempt_expires_at ||
    Date.parse(registration.claim_expires_at) <= Date.parse(input.now) ||
    (registration.status === "anonymous_claim_pending" &&
      Date.parse(registration.claim_attempt_expires_at) <= Date.parse(input.now)) ||
    (registration.status === "anonymous_claim_pending" && registration.claim_attempt_failures >= input.maxFailures) ||
    (registration.status !== "anonymous_claim_pending" && registration.claim_attempt_actor_id !== input.actorId)
  ) {
    return null;
  }
  if (!bytesEqual(registration.user_code_hash, input.userCodeHash)) {
    if (registration.status === "anonymous_claim_pending") {
      registration.claim_attempt_failures += 1;
    }
    return { kind: "mismatch" };
  }
  if (registration.status === "anonymous_claim_pending") {
    registration.status = "anonymous_claiming";
    registration.claim_attempt_actor_id = input.actorId;
  }
  return { kind: "ready", registration };
}

function checkVerifiedClaimAttempt(
  state: LocalState,
  input: Parameters<Entities["agentAuth"]["checkVerifiedClaimAttempt"]>[0],
): Awaited<ReturnType<Entities["agentAuth"]["checkVerifiedClaimAttempt"]>> {
  const registration = state.agentAuthRegistrations.get(input.registrationId);
  if (
    !registration ||
    registration.registration_type !== "identity_assertion" ||
    registration.status !== "pending_step_up" ||
    !registration.claim_expires_at ||
    Date.parse(registration.claim_expires_at) <= Date.parse(input.now) ||
    registration.claim_attempt_failures >= input.maxFailures ||
    registration.workspace_member_id !== input.actorId ||
    registration.email.toLowerCase() !== input.actorEmail.toLowerCase()
  ) {
    return null;
  }
  if (bytesEqual(registration.user_code_hash, input.userCodeHash)) {
    return { kind: "ready", registration };
  }
  registration.claim_attempt_failures += 1;
  registration.updated_at = input.now;
  return { kind: "mismatch" };
}

export function localAgentAuth(state: LocalState): Entities["agentAuth"] {
  return {
    async insertDelegation(delegation) {
      state.agentAuthDelegations.set(delegation.id, delegation);
    },
    async findActiveDelegation(input) {
      return findActiveDelegation(state, input);
    },
    async findDelegationByIdForUpdate(id) {
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
      const delegation = findActiveDelegation(state, input);
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
    async findRegistrationByIdForUpdate(id) {
      return state.agentAuthRegistrations.get(id) ?? null;
    },
    async findRegistrationByClaimTokenHash(claimTokenHash) {
      return (
        [...state.agentAuthRegistrations.values()].find((registration) =>
          bytesEqual(registration.claim_token_hash, claimTokenHash),
        ) ?? null
      );
    },
    async checkVerifiedClaimAttempt(input) {
      return checkVerifiedClaimAttempt(state, input);
    },
    async markRegistrationVerified(id, input) {
      const registration = state.agentAuthRegistrations.get(id);
      if (!registration || registration.status !== "pending_step_up") {
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
      if (
        !registration ||
        (registration.status !== "anonymous_unclaimed" && registration.status !== "anonymous_claim_pending")
      ) {
        return null;
      }
      registration.status = "anonymous_claim_pending";
      registration.claim_attempt_token_hash = input.claimAttemptTokenHash;
      registration.claim_attempt_actor_id = null;
      registration.user_code_hash = input.userCodeHash;
      registration.claim_attempt_expires_at = input.claimAttemptExpiresAt;
      registration.claim_attempt_failures = 0;
      registration.updated_at = input.updatedAt;
      return registration;
    },
    async checkAnonymousClaimAttempt(input) {
      return checkAnonymousClaimAttempt(state, input);
    },
    async markAnonymousRegistrationVerified(id, input) {
      const registration = state.agentAuthRegistrations.get(id);
      if (!registration || registration.status !== "anonymous_claiming") {
        return null;
      }
      registration.workspace_id = input.workspaceId;
      registration.workspace_member_id = input.workspaceMemberId;
      registration.email = input.email;
      registration.status = "verified";
      registration.completed_at = input.completedAt;
      registration.expires_at = input.expiresAt;
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
