import { EPHEMERAL_AUTO_DELETION_DAYS } from "@agent-paste/config";
import { createId } from "../../id.js";
import type { AgentAuthRegistration } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { nowIso, PLATFORM_SCOPE } from "../core-helpers.js";
import type { CommandActor } from "../ports.js";
import {
  type AgentAuthRegistrationView,
  buildClaimAttempt,
  bytesEqual,
  insertRegistrationAudit,
  registrationView,
  secondsFrom,
  sha256Bytes,
} from "./agent-auth-workflow-helpers.js";
import {
  claimResolvedEphemeralWorkspaceWithReplayState,
  DEFAULT_CLAIM_TOKEN_TTL_SECONDS,
  insertEphemeralWorkspaceProvision,
} from "./ephemeral-workflow.js";

const AGENT_AUTH_ACTOR: CommandActor = { type: "system", id: "agent-auth", workspaceId: null };

export type RegisterAgentAnonymousIdentityInput = {
  audience: string;
  claimTokenExpiresInSeconds?: number;
  now?: Date;
};

export type RegisterAgentAnonymousIdentityResult = {
  kind: "registered";
  registration: AgentAuthRegistrationView;
  claim_token: string;
  claim_expires_at: string;
};

export type StartAgentAuthAnonymousClaimResult =
  | {
      kind: "initiated";
      registration: AgentAuthRegistrationView;
      claim_token_expires_at: string;
      claim_attempt_token: string;
      user_code: string;
      claim_attempt_expires_at: string;
    }
  | { kind: "expired_token" }
  | { kind: "invalid_grant" };

export async function registerAgentAnonymousIdentity(
  ctx: RepositoryCoreContext,
  input: RegisterAgentAnonymousIdentityInput,
): Promise<RegisterAgentAnonymousIdentityResult> {
  const now = nowIso(input.now);
  const workspaceId = crypto.randomUUID();
  const claimExpiresAt = secondsFrom(now, input.claimTokenExpiresInSeconds ?? DEFAULT_CLAIM_TOKEN_TTL_SECONDS);
  const registrationId = createId("reg");
  return ctx.uow.command(
    {
      actor: AGENT_AUTH_ACTOR,
      operation: "agent_auth.anonymous.register",
      idempotencyKey: crypto.randomUUID(),
      scope: PLATFORM_SCOPE,
      now,
    },
    async (entities) => {
      const provisioned = await insertEphemeralWorkspaceProvision(ctx, entities, {
        workspace: {
          id: workspaceId,
          name: "Ephemeral workspace",
          contact_email: null,
          plan: "free",
          plan_operator_override_at: null,
          claimed_at: null,
          auto_deletion_days: EPHEMERAL_AUTO_DELETION_DAYS,
          revision_retention_days: null,
          created_at: now,
          updated_at: now,
        },
        claimExpiresAt,
        now,
      });
      const registration: AgentAuthRegistration = {
        id: registrationId,
        registration_type: "anonymous",
        delegation_id: null,
        workspace_id: workspaceId,
        workspace_member_id: null,
        provider_issuer: "agent-paste:anonymous",
        provider_subject: registrationId,
        audience: input.audience,
        provider_client_id: "anonymous",
        email: "",
        status: "anonymous_unclaimed",
        claim_token_id: provisioned.claim_token.id,
        claim_token_hash: await sha256Bytes(provisioned.claim_token_secret),
        claim_attempt_token_hash: null,
        user_code_hash: null,
        claim_expires_at: provisioned.claim_token.expires_at,
        claim_attempt_expires_at: null,
        completed_at: null,
        expires_at: claimExpiresAt,
        created_at: now,
        updated_at: now,
      };
      await entities.agentAuth.insertRegistration(registration);
      await insertRegistrationAudit(entities, registration, now);
      return {
        kind: "registered",
        registration: registrationView(registration),
        claim_token: provisioned.claim_token_secret,
        claim_expires_at: provisioned.claim_token.expires_at,
      };
    },
  );
}

export async function startAgentAuthAnonymousClaim(
  ctx: RepositoryCoreContext,
  input: { claimToken: string; claimAttemptExpiresInSeconds: number; now?: Date },
): Promise<StartAgentAuthAnonymousClaimResult> {
  const now = nowIso(input.now);
  const claimTokenHash = await sha256Bytes(input.claimToken);
  return ctx.uow.command(
    {
      actor: AGENT_AUTH_ACTOR,
      operation: "agent_auth.anonymous_claim.start",
      idempotencyKey: crypto.randomUUID(),
      scope: PLATFORM_SCOPE,
      now,
    },
    async (entities) => {
      const registration = await entities.agentAuth.findRegistrationByClaimTokenHash(claimTokenHash);
      if (!registration?.claim_expires_at || registration.registration_type !== "anonymous") {
        return { kind: "invalid_grant" };
      }
      if (Date.parse(registration.claim_expires_at) <= Date.parse(now)) {
        return { kind: "expired_token" };
      }
      if (registration.status === "verified" || registration.status === "revoked") {
        return { kind: "invalid_grant" };
      }
      if (registration.status !== "anonymous_unclaimed" && registration.status !== "anonymous_claim_pending") {
        return { kind: "invalid_grant" };
      }

      const claim = await buildClaimAttempt(input.claimAttemptExpiresInSeconds, now);
      const updated = await entities.agentAuth.markAnonymousClaimPending(registration.id, {
        claimAttemptTokenHash: await sha256Bytes(claim.claimAttemptToken),
        userCodeHash: await sha256Bytes(claim.userCode),
        claimAttemptExpiresAt: claim.expiresAt,
        updatedAt: now,
      });
      if (!updated) {
        return { kind: "invalid_grant" };
      }
      await entities.operationEvents.insert({
        actorType: "system",
        actorId: "agent-auth",
        action: "agent_auth.anonymous_claim.started",
        targetType: "agent_auth_registration",
        targetId: updated.id,
        workspaceId: updated.workspace_id,
        details: {},
        occurredAt: now,
      });
      return {
        kind: "initiated",
        registration: registrationView(updated),
        claim_token_expires_at: registration.claim_expires_at,
        claim_attempt_token: claim.claimAttemptToken,
        user_code: claim.userCode,
        claim_attempt_expires_at: claim.expiresAt,
      };
    },
  );
}

export async function completeAgentAuthAnonymousClaim(
  ctx: RepositoryCoreContext,
  input: {
    actor: {
      type: "member";
      id: string;
      workspace_id: string;
      email: string;
      scopes: Array<"publish" | "read" | "admin">;
    };
    claimAttemptToken: string;
    userCode: string;
    now?: Date;
  },
): Promise<AgentAuthRegistrationView | null> {
  const now = nowIso(input.now);
  const claimAttemptTokenHash = await sha256Bytes(input.claimAttemptToken);
  const userCodeHash = await sha256Bytes(input.userCode);
  const prepared = await ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const registration = await entities.agentAuth.findRegistrationByClaimAttemptTokenHash(claimAttemptTokenHash);
    if (
      !registration ||
      registration.registration_type !== "anonymous" ||
      registration.status !== "anonymous_claim_pending" ||
      !registration.claim_token_id ||
      !registration.claim_expires_at ||
      !registration.claim_attempt_expires_at ||
      !registration.workspace_id
    ) {
      return null;
    }
    if (
      Date.parse(registration.claim_expires_at) <= Date.parse(now) ||
      Date.parse(registration.claim_attempt_expires_at) <= Date.parse(now)
    ) {
      return null;
    }
    if (!bytesEqual(registration.user_code_hash, userCodeHash)) {
      return null;
    }
    const claimToken = await entities.claimTokens.findById(registration.claim_token_id);
    if (!claimToken) {
      return null;
    }
    return { registration, claimToken };
  });
  if (!prepared) {
    return null;
  }

  const claimed = await claimResolvedEphemeralWorkspaceWithReplayState(ctx, {
    actor: input.actor,
    claimToken: prepared.claimToken,
    idempotencyKey: `agent-auth-anonymous:${prepared.registration.id}`,
    ...(input.now ? { now: input.now } : {}),
  });

  return ctx.uow.command(
    {
      actor: { type: "member", id: input.actor.id, workspaceId: input.actor.workspace_id },
      operation: "agent_auth.anonymous_claim.complete",
      idempotencyKey: prepared.registration.id,
      scope: PLATFORM_SCOPE,
      now,
    },
    async (entities) => {
      const registration = await entities.agentAuth.findRegistrationById(prepared.registration.id);
      if (!registration || registration.registration_type !== "anonymous") {
        return null;
      }
      if (registration.status !== "anonymous_claim_pending" && registration.status !== "verified") {
        return null;
      }
      const completed =
        registration.status === "verified"
          ? registration
          : await entities.agentAuth.markAnonymousRegistrationVerified(registration.id, {
              workspaceId: claimed.result.destination_workspace_id,
              workspaceMemberId: input.actor.id,
              email: input.actor.email.toLowerCase(),
              completedAt: now,
              updatedAt: now,
            });
      if (!completed) {
        return null;
      }
      await entities.operationEvents.insert({
        actorType: "member",
        actorId: input.actor.id,
        action: "agent_auth.anonymous_claim.completed",
        targetType: "agent_auth_registration",
        targetId: completed.id,
        workspaceId: input.actor.workspace_id,
        details: {
          source_workspace_id: claimed.result.source_workspace_id,
          artifact_ids: claimed.result.artifact_ids,
        },
        occurredAt: now,
      });
      return registrationView(completed);
    },
  );
}
