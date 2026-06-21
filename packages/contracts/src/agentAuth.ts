import { z } from "./zod.js";

export const AGENT_AUTH_ID_JAG_ASSERTION_TYPE = "urn:ietf:params:oauth:token-type:id-jag";
export const AGENT_AUTH_JWT_BEARER_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";
export const AGENT_AUTH_CLAIM_GRANT_TYPE = "urn:workos:agent-auth:grant-type:claim";
export const AGENT_AUTH_REVOKED_EVENT = "https://schemas.workos.com/events/agent/auth/identity/assertion/revoked";

export const AgentAuthScope = z.enum(["read", "publish"]);
export type AgentAuthScope = z.infer<typeof AgentAuthScope>;

export const agentAuthScopes = ["read", "publish"] as const satisfies AgentAuthScope[];

export const AgentIdentityAssertionRequest = z.object({
  type: z.literal("identity_assertion"),
  assertion_type: z.literal(AGENT_AUTH_ID_JAG_ASSERTION_TYPE),
  assertion: z.string().min(1),
});
export type AgentIdentityAssertionRequest = z.infer<typeof AgentIdentityAssertionRequest>;

export const AgentIdentityAnonymousRequest = z.object({
  type: z.literal("anonymous"),
});
export type AgentIdentityAnonymousRequest = z.infer<typeof AgentIdentityAnonymousRequest>;

export const AgentIdentityRequest = z.discriminatedUnion("type", [
  AgentIdentityAssertionRequest,
  AgentIdentityAnonymousRequest,
]);
export type AgentIdentityRequest = z.infer<typeof AgentIdentityRequest>;

export const AgentIdentityAssertionSuccessResponse = z.object({
  registration_id: z.string(),
  registration_type: z.literal("identity_assertion"),
  identity_assertion: z.string(),
  assertion_expires: z.string(),
  scopes: z.array(AgentAuthScope),
});
export type AgentIdentityAssertionSuccessResponse = z.infer<typeof AgentIdentityAssertionSuccessResponse>;

export const AgentIdentityAnonymousSuccessResponse = z.object({
  registration_id: z.string(),
  registration_type: z.literal("anonymous"),
  identity_assertion: z.string(),
  assertion_expires: z.string(),
  scopes: z.array(AgentAuthScope),
  claim_url: z.string(),
  claim_token: z.string(),
  claim_token_expires: z.string(),
  pre_claim_scopes: z.array(AgentAuthScope),
  post_claim_scopes: z.array(AgentAuthScope),
});
export type AgentIdentityAnonymousSuccessResponse = z.infer<typeof AgentIdentityAnonymousSuccessResponse>;

export const AgentIdentitySuccessResponse = z.discriminatedUnion("registration_type", [
  AgentIdentityAssertionSuccessResponse,
  AgentIdentityAnonymousSuccessResponse,
]);
export type AgentIdentitySuccessResponse = z.infer<typeof AgentIdentitySuccessResponse>;

export const AgentIdentityStepUpResponse = z.object({
  error: z.literal("interaction_required"),
  error_description: z.string(),
  registration_id: z.string(),
  registration_type: z.literal("identity_assertion"),
  claim_url: z.string(),
  claim_token: z.string(),
  claim_token_expires: z.string(),
  post_claim_scopes: z.array(AgentAuthScope),
  claim: z.object({
    user_code: z.string(),
    expires_in: z.number(),
    verification_uri: z.string(),
    interval: z.number(),
  }),
});
export type AgentIdentityStepUpResponse = z.infer<typeof AgentIdentityStepUpResponse>;

export const AgentAuthTokenResponse = z.object({
  access_token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.number(),
  scope: z.string(),
});
export type AgentAuthTokenResponse = z.infer<typeof AgentAuthTokenResponse>;

export const AgentAuthClaimTokenResponse = AgentAuthTokenResponse.extend({
  identity_assertion: z.string(),
  assertion_expires: z.string(),
});
export type AgentAuthClaimTokenResponse = z.infer<typeof AgentAuthClaimTokenResponse>;

export const AgentIdentityClaimResponse = z.object({
  claim_token: z.string(),
  claim_token_expires: z.string(),
  claim_attempt_token: z.string(),
  registration_id: z.string(),
  registration_type: z.literal("anonymous"),
  claim: z.object({
    user_code: z.string(),
    expires_in: z.number(),
    verification_uri: z.string(),
    interval: z.number(),
  }),
});
export type AgentIdentityClaimResponse = z.infer<typeof AgentIdentityClaimResponse>;
