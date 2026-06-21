import { base64UrlEncode } from "@agent-paste/tokens/crypto";
import { createId } from "../../id.js";
import type { AgentAuthDelegation, AgentAuthRegistration, ApiKey, WorkspaceMember } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import type { Entities } from "../ports.js";
import { buildApiKey } from "../shared.js";

type IdentityFields = {
  providerIssuer: string;
  providerSubject: string;
  audience: string;
  providerClientId: string;
  email: string;
};

export type AgentAuthRegistrationView = {
  id: string;
  registration_type: "identity_assertion" | "anonymous";
  expires_at: string;
  scopes: Array<"read" | "publish">;
};

export const AGENT_AUTH_SCOPES = ["read", "publish"] as const;

export async function buildAgentAccessToken(
  ctx: RepositoryCoreContext,
  workspaceId: string,
  now: string,
  expiresInSeconds: number,
): Promise<{ apiKey: ApiKey; secret: string }> {
  return buildApiKey(ctx.options, {
    workspaceId,
    name: "Agent auth",
    now,
    expiresAt: secondsFrom(now, expiresInSeconds),
  });
}

export async function insertVerifiedRegistration(
  entities: Entities,
  input: IdentityFields,
  delegation: AgentAuthDelegation,
  expiresAt: string,
  now: string,
): Promise<AgentAuthRegistration> {
  const registration: AgentAuthRegistration = {
    id: createId("reg"),
    registration_type: "identity_assertion",
    delegation_id: delegation.id,
    workspace_id: delegation.workspace_id,
    workspace_member_id: delegation.workspace_member_id,
    provider_issuer: input.providerIssuer,
    provider_subject: input.providerSubject,
    audience: input.audience,
    provider_client_id: input.providerClientId,
    email: input.email,
    status: "verified",
    claim_token_id: null,
    claim_token_hash: null,
    claim_attempt_token_hash: null,
    user_code_hash: null,
    claim_expires_at: null,
    claim_attempt_expires_at: null,
    completed_at: now,
    expires_at: expiresAt,
    created_at: now,
    updated_at: now,
  };
  await entities.agentAuth.insertRegistration(registration);
  await insertRegistrationAudit(entities, registration, now);
  return registration;
}

export async function insertDelegation(
  entities: Entities,
  input: IdentityFields,
  member: WorkspaceMember,
  workspaceId: string,
  now: string,
): Promise<AgentAuthDelegation> {
  const delegation: AgentAuthDelegation = {
    id: createId("agd"),
    workspace_id: workspaceId,
    workspace_member_id: member.id,
    provider_issuer: input.providerIssuer,
    provider_subject: input.providerSubject,
    audience: input.audience,
    provider_client_id: input.providerClientId,
    email: input.email,
    created_at: now,
    last_seen_at: now,
    revoked_at: null,
  };
  await entities.agentAuth.insertDelegation(delegation);
  await entities.operationEvents.insert({
    actorType: "system",
    actorId: "agent-auth",
    action: "agent_auth.delegation.created",
    targetType: "agent_auth_delegation",
    targetId: delegation.id,
    workspaceId,
    details: { provider_issuer: input.providerIssuer },
    occurredAt: now,
  });
  return delegation;
}

export async function insertRegistrationAudit(entities: Entities, registration: AgentAuthRegistration, now: string) {
  await entities.operationEvents.insert({
    actorType: "system",
    actorId: "agent-auth",
    action: "agent_auth.registration.created",
    targetType: "agent_auth_registration",
    targetId: registration.id,
    workspaceId: registration.workspace_id,
    details: { status: registration.status, provider_issuer: registration.provider_issuer },
    occurredAt: now,
  });
}

export function registrationView(registration: AgentAuthRegistration): AgentAuthRegistrationView {
  return {
    id: registration.id,
    registration_type: registration.registration_type,
    expires_at: registration.expires_at,
    scopes: [...AGENT_AUTH_SCOPES],
  };
}

export function identityKey(input: Pick<IdentityFields, "providerIssuer" | "providerSubject" | "audience">) {
  return {
    providerIssuer: input.providerIssuer,
    providerSubject: input.providerSubject,
    audience: input.audience,
  };
}

export async function syntheticWorkOsUserId(
  input: Pick<IdentityFields, "providerIssuer" | "providerSubject" | "audience">,
): Promise<string> {
  const digest = await sha256Bytes(`${input.providerIssuer}\n${input.providerSubject}\n${input.audience}`);
  return `agent-auth:${base64UrlEncode(digest)}`;
}

export async function buildClaim(expiresInSeconds: number, now: string) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const claimToken = `clm_${base64UrlEncode(tokenBytes)}`;
  return {
    claimToken,
    userCode: randomUserCode(),
    expiresAt: secondsFrom(now, expiresInSeconds),
  };
}

export async function buildClaimAttempt(expiresInSeconds: number, now: string) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  return {
    claimAttemptToken: `cat_${base64UrlEncode(tokenBytes)}`,
    userCode: randomUserCode(),
    expiresAt: secondsFrom(now, expiresInSeconds),
  };
}

export function randomUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return String((bytes[0] ?? 0) % 1_000_000).padStart(6, "0");
}

export function secondsFrom(now: string, seconds: number): string {
  return new Date(Date.parse(now) + seconds * 1000).toISOString();
}

export async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

export function bytesEqual(left: Uint8Array | null, right: Uint8Array): boolean {
  if (!left || left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}
