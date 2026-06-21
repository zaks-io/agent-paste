import { parseApiKey } from "../../api-keys.js";
import { createId } from "../../id.js";
import type { AgentAuthRegistration } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { nowIso, PLATFORM_SCOPE } from "../core-helpers.js";
import type { CommandActor } from "../ports.js";
import {
  type AgentAuthRegistrationView,
  buildAgentAccessToken,
  buildClaim,
  bytesEqual,
  identityKey,
  insertDelegation,
  insertRegistrationAudit,
  insertVerifiedRegistration,
  registrationView,
  secondsFrom,
  sha256Bytes,
  syntheticWorkOsUserId,
} from "./agent-auth-workflow-helpers.js";
import { provisionWebMember } from "./web-member-workflow.js";

export type RegisterAgentVerifiedIdentityInput = {
  providerIssuer: string;
  providerSubject: string;
  audience: string;
  providerClientId: string;
  email: string;
  jti: string;
  jtiExpiresAt: string;
  assertionExpiresInSeconds: number;
  claimExpiresInSeconds: number;
  now?: Date;
};

export type RegisterAgentVerifiedIdentityResult =
  | { kind: "verified"; registration: AgentAuthRegistrationView }
  | {
      kind: "interaction_required";
      registration: AgentAuthRegistrationView;
      claim_token: string;
      user_code: string;
      claim_expires_at: string;
    }
  | { kind: "replay_detected" }
  | { kind: "ambiguous_email" };

export type AgentAuthClaimView = {
  registration_id: string;
  registration_type: "identity_assertion";
  email: string;
  provider_issuer: string;
  provider_client_id: string;
  expires_at: string;
  completed_at: string | null;
};

export type ExchangeAgentAuthResult =
  | {
      kind: "issued";
      access_token: string;
      expires_in: number;
      registration: AgentAuthRegistrationView;
    }
  | { kind: "authorization_pending" }
  | { kind: "expired_token" }
  | { kind: "invalid_grant" };

const AGENT_AUTH_ACTOR: CommandActor = { type: "system", id: "agent-auth", workspaceId: null };

export async function registerAgentVerifiedIdentity(
  ctx: RepositoryCoreContext,
  input: RegisterAgentVerifiedIdentityInput,
): Promise<RegisterAgentVerifiedIdentityResult> {
  const now = nowIso(input.now);
  const expiresAt = secondsFrom(now, input.assertionExpiresInSeconds);
  return ctx.uow.command(
    {
      actor: AGENT_AUTH_ACTOR,
      operation: "agent_auth.identity.register",
      idempotencyKey: crypto.randomUUID(),
      scope: PLATFORM_SCOPE,
      now,
    },
    async (entities) => {
      const insertedJti = await entities.agentAuth.insertJti({
        provider_issuer: input.providerIssuer,
        jti: input.jti,
        expires_at: input.jtiExpiresAt,
        created_at: now,
      });
      if (!insertedJti) {
        return { kind: "replay_detected" };
      }

      const existingDelegation = await entities.agentAuth.findActiveDelegation(identityKey(input));
      if (existingDelegation) {
        await entities.agentAuth.updateDelegationSeen(existingDelegation.id, {
          email: input.email,
          lastSeenAt: now,
        });
        const registration = await insertVerifiedRegistration(entities, input, existingDelegation, expiresAt, now);
        return { kind: "verified", registration: registrationView(registration) };
      }

      const emailMatches = await entities.members.findByEmail(input.email);
      if (emailMatches.length === 0) {
        const provisioned = await provisionWebMember(
          ctx,
          entities,
          { workosUserId: await syntheticWorkOsUserId(input), email: input.email, actorId: "agent-auth" },
          now,
        );
        const member = await entities.members.findById(provisioned.workspace_member.id);
        const workspaceId = provisioned.workspace.id;
        if (!member) {
          return { kind: "ambiguous_email" };
        }
        const delegation = await insertDelegation(entities, input, member, workspaceId, now);
        const registration = await insertVerifiedRegistration(entities, input, delegation, expiresAt, now);
        return { kind: "verified", registration: registrationView(registration) };
      }

      if (emailMatches.length > 1) {
        return { kind: "ambiguous_email" };
      }

      const claim = await buildClaim(input.claimExpiresInSeconds, now);
      const member = emailMatches[0];
      if (!member) {
        return { kind: "ambiguous_email" };
      }
      const registration: AgentAuthRegistration = {
        id: createId("reg"),
        registration_type: "identity_assertion",
        delegation_id: null,
        workspace_id: member.workspace_id,
        workspace_member_id: member.id,
        provider_issuer: input.providerIssuer,
        provider_subject: input.providerSubject,
        audience: input.audience,
        provider_client_id: input.providerClientId,
        email: input.email,
        status: "pending_step_up",
        claim_token_id: null,
        claim_token_hash: await sha256Bytes(claim.claimToken),
        claim_attempt_token_hash: null,
        user_code_hash: await sha256Bytes(claim.userCode),
        claim_expires_at: claim.expiresAt,
        claim_attempt_expires_at: claim.expiresAt,
        completed_at: null,
        expires_at: expiresAt,
        created_at: now,
        updated_at: now,
      };
      await entities.agentAuth.insertRegistration(registration);
      await insertRegistrationAudit(entities, registration, now);
      return {
        kind: "interaction_required",
        registration: registrationView(registration),
        claim_token: claim.claimToken,
        user_code: claim.userCode,
        claim_expires_at: claim.expiresAt,
      };
    },
  );
}

export async function getAgentAuthClaim(
  ctx: RepositoryCoreContext,
  input: { claimToken: string; now?: Date },
): Promise<AgentAuthClaimView | null> {
  const now = nowIso(input.now);
  const hash = await sha256Bytes(input.claimToken);
  return ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const registration = await entities.agentAuth.findRegistrationByClaimTokenHash(hash);
    if (
      !registration?.claim_expires_at ||
      registration.registration_type !== "identity_assertion" ||
      registration.status !== "pending_step_up" ||
      Date.parse(registration.claim_expires_at) <= Date.parse(now)
    ) {
      return null;
    }
    return {
      registration_id: registration.id,
      registration_type: "identity_assertion",
      email: registration.email,
      provider_issuer: registration.provider_issuer,
      provider_client_id: registration.provider_client_id,
      expires_at: registration.claim_expires_at,
      completed_at: registration.completed_at,
    };
  });
}

export async function completeAgentAuthClaim(
  ctx: RepositoryCoreContext,
  input: {
    actor: { id: string; workspace_id: string; email: string };
    claimToken: string;
    userCode: string;
    now?: Date;
  },
): Promise<AgentAuthRegistrationView | null> {
  const now = nowIso(input.now);
  const claimTokenHash = await sha256Bytes(input.claimToken);
  const userCodeHash = await sha256Bytes(input.userCode);
  return ctx.uow.command(
    {
      actor: { type: "member", id: input.actor.id, workspaceId: input.actor.workspace_id },
      operation: "agent_auth.claim.complete",
      idempotencyKey: input.claimToken,
      scope: PLATFORM_SCOPE,
      now,
    },
    async (entities) => {
      const registration = await entities.agentAuth.findRegistrationByClaimTokenHash(claimTokenHash);
      if (!registration || registration.status !== "pending_step_up" || !registration.claim_expires_at) {
        return null;
      }
      if (Date.parse(registration.claim_expires_at) <= Date.parse(now)) {
        return null;
      }
      if (
        registration.workspace_member_id !== input.actor.id ||
        registration.email !== input.actor.email.toLowerCase()
      ) {
        return null;
      }
      if (!bytesEqual(registration.user_code_hash, userCodeHash)) {
        return null;
      }
      const member = await entities.members.findById(input.actor.id);
      if (!member || !registration.workspace_id) {
        return null;
      }
      const existing = await entities.agentAuth.findActiveDelegation({
        providerIssuer: registration.provider_issuer,
        providerSubject: registration.provider_subject,
        audience: registration.audience,
      });
      const delegation =
        existing ??
        (await insertDelegation(
          entities,
          {
            providerIssuer: registration.provider_issuer,
            providerSubject: registration.provider_subject,
            audience: registration.audience,
            providerClientId: registration.provider_client_id,
            email: registration.email,
          },
          member,
          registration.workspace_id,
          now,
        ));
      const completed = await entities.agentAuth.markRegistrationVerified(registration.id, {
        delegationId: delegation.id,
        completedAt: now,
        updatedAt: now,
      });
      if (!completed) {
        return null;
      }
      await entities.operationEvents.insert({
        actorType: "member",
        actorId: input.actor.id,
        action: "agent_auth.claim.completed",
        targetType: "agent_auth_registration",
        targetId: completed.id,
        workspaceId: input.actor.workspace_id,
        details: { provider_issuer: completed.provider_issuer },
        occurredAt: now,
      });
      return registrationView(completed);
    },
  );
}

export async function exchangeAgentAuthIdentityAssertion(
  ctx: RepositoryCoreContext,
  input: {
    registrationId: string;
    anonymousClaimState?: "pre_claim" | "post_claim";
    accessTokenExpiresInSeconds: number;
    now?: Date;
  },
): Promise<ExchangeAgentAuthResult> {
  return exchangeRegistration(ctx, input, { allowAnonymousPreClaim: true });
}

export async function exchangeAgentAuthClaimToken(
  ctx: RepositoryCoreContext,
  input: { claimToken: string; accessTokenExpiresInSeconds: number; now?: Date },
): Promise<ExchangeAgentAuthResult> {
  const now = nowIso(input.now);
  const hash = await sha256Bytes(input.claimToken);
  const registration = await ctx.uow.read(PLATFORM_SCOPE, (entities) =>
    entities.agentAuth.findRegistrationByClaimTokenHash(hash),
  );
  if (!registration?.claim_expires_at || Date.parse(registration.claim_expires_at) <= Date.parse(now)) {
    return { kind: "expired_token" };
  }
  if (
    registration.status === "pending_step_up" ||
    registration.status === "anonymous_unclaimed" ||
    registration.status === "anonymous_claim_pending"
  ) {
    return { kind: "authorization_pending" };
  }
  return exchangeRegistration(ctx, {
    registrationId: registration.id,
    accessTokenExpiresInSeconds: input.accessTokenExpiresInSeconds,
    ...(registration.registration_type === "anonymous" ? { anonymousClaimState: "post_claim" as const } : {}),
    ...(input.now ? { now: input.now } : {}),
  });
}

export async function revokeAgentAuthAccessToken(
  ctx: RepositoryCoreContext,
  input: { token: string; now?: Date },
): Promise<boolean> {
  const parsed = parseApiKey(input.token);
  if (!parsed) {
    return false;
  }
  const now = nowIso(input.now);
  const row = await ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const apiKey = await entities.apiKeys.findByPublicId(parsed.publicId);
    const accessToken = apiKey ? await entities.agentAuth.findAccessTokenByApiKeyId(apiKey.id) : null;
    return apiKey && accessToken ? { apiKey, accessToken } : null;
  });
  if (!row || row.apiKey.revoked_at) {
    return false;
  }
  await ctx.uow.command(
    {
      actor: AGENT_AUTH_ACTOR,
      operation: "agent_auth.access_token.revoke",
      idempotencyKey: row.apiKey.id,
      scope: PLATFORM_SCOPE,
      now,
    },
    async (entities) => {
      await entities.apiKeys.updateRevokedAt(row.apiKey.id, now);
      await entities.operationEvents.insert({
        actorType: "system",
        actorId: "agent-auth",
        action: "agent_auth.access_token.revoked",
        targetType: "api_key",
        targetId: row.apiKey.id,
        workspaceId: row.apiKey.workspace_id,
        details: { registration_id: row.accessToken.registration_id },
        occurredAt: now,
      });
      return true;
    },
  );
  return true;
}

export async function revokeAgentAuthProviderIdentity(
  ctx: RepositoryCoreContext,
  input: {
    providerIssuer: string;
    providerSubject: string;
    audience: string;
    jti: string;
    jtiExpiresAt: string;
    now?: Date;
  },
): Promise<"revoked" | "not_found" | "replay_detected"> {
  const now = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: AGENT_AUTH_ACTOR,
      operation: "agent_auth.delegation.revoke",
      idempotencyKey: crypto.randomUUID(),
      scope: PLATFORM_SCOPE,
      now,
    },
    async (entities) => {
      const insertedJti = await entities.agentAuth.insertJti({
        provider_issuer: input.providerIssuer,
        jti: input.jti,
        expires_at: input.jtiExpiresAt,
        created_at: now,
      });
      if (!insertedJti) {
        return "replay_detected";
      }
      const delegation = await entities.agentAuth.revokeActiveDelegation({
        providerIssuer: input.providerIssuer,
        providerSubject: input.providerSubject,
        audience: input.audience,
        revokedAt: now,
      });
      if (!delegation) {
        return "not_found";
      }
      const accessTokens = await entities.agentAuth.listAccessTokensForDelegation(delegation.id);
      for (const accessToken of accessTokens) {
        await entities.apiKeys.updateRevokedAt(accessToken.api_key_id, now);
      }
      await entities.operationEvents.insert({
        actorType: "system",
        actorId: "agent-auth",
        action: "agent_auth.delegation.revoked",
        targetType: "agent_auth_delegation",
        targetId: delegation.id,
        workspaceId: delegation.workspace_id,
        details: { provider_issuer: delegation.provider_issuer, token_count: accessTokens.length },
        occurredAt: now,
      });
      return "revoked";
    },
  );
}

async function exchangeRegistration(
  ctx: RepositoryCoreContext,
  input: {
    registrationId: string;
    anonymousClaimState?: "pre_claim" | "post_claim";
    accessTokenExpiresInSeconds: number;
    now?: Date;
  },
  options: { allowAnonymousPreClaim?: boolean } = {},
): Promise<ExchangeAgentAuthResult> {
  const now = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: AGENT_AUTH_ACTOR,
      operation: "agent_auth.access_token.issue",
      idempotencyKey: crypto.randomUUID(),
      scope: PLATFORM_SCOPE,
      now,
    },
    async (entities) => {
      const registration = await entities.agentAuth.findRegistrationById(input.registrationId);
      if (!registration) {
        return { kind: "invalid_grant" };
      }
      if (registration.status === "pending_step_up") {
        return { kind: "authorization_pending" };
      }
      const anonymousPreClaim =
        registration.registration_type === "anonymous" &&
        options.allowAnonymousPreClaim === true &&
        (registration.status === "anonymous_unclaimed" || registration.status === "anonymous_claim_pending");
      if (anonymousPreClaim && input.anonymousClaimState !== "pre_claim") {
        return { kind: "invalid_grant" };
      }
      if (
        registration.registration_type === "anonymous" &&
        registration.status === "verified" &&
        input.anonymousClaimState !== "post_claim"
      ) {
        return { kind: "invalid_grant" };
      }
      if (registration.registration_type === "anonymous" && !anonymousPreClaim && registration.status !== "verified") {
        return { kind: "authorization_pending" };
      }
      if (
        (!anonymousPreClaim && registration.status !== "verified") ||
        !registration.workspace_id ||
        Date.parse(registration.expires_at) <= Date.parse(now)
      ) {
        return { kind: "expired_token" };
      }
      let delegationId: string | null = null;
      if (registration.registration_type === "identity_assertion") {
        if (!registration.delegation_id) {
          return { kind: "expired_token" };
        }
        const delegation = await entities.agentAuth.findDelegationById(registration.delegation_id);
        if (!delegation || delegation.revoked_at) {
          return { kind: "invalid_grant" };
        }
        delegationId = delegation.id;
      }
      const { apiKey, secret } = await buildAgentAccessToken(
        ctx,
        registration.workspace_id,
        now,
        input.accessTokenExpiresInSeconds,
      );
      await entities.apiKeys.insert(apiKey);
      await entities.agentAuth.insertAccessToken({
        api_key_id: apiKey.id,
        registration_id: registration.id,
        delegation_id: delegationId,
        issued_at: now,
      });
      await entities.operationEvents.insert({
        actorType: "system",
        actorId: "agent-auth",
        action: "agent_auth.access_token.issued",
        targetType: "api_key",
        targetId: apiKey.id,
        workspaceId: apiKey.workspace_id,
        details: { registration_id: registration.id, delegation_id: delegationId },
        occurredAt: now,
      });
      return {
        kind: "issued",
        access_token: secret,
        expires_in: input.accessTokenExpiresInSeconds,
        registration: registrationView(registration),
      };
    },
  );
}
