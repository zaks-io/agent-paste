import { parseAgentAuthTrustedProviders } from "@agent-paste/auth";
import {
  AGENT_AUTH_CLAIM_GRANT_TYPE,
  AGENT_AUTH_ID_JAG_ASSERTION_TYPE,
  AGENT_AUTH_JWT_BEARER_GRANT_TYPE,
  AGENT_AUTH_REVOKED_EVENT,
  agentAuthScopes,
} from "@agent-paste/contracts";
import { applyEphemeralProvisionRateLimit } from "@agent-paste/worker-runtime";
import type { AppContext, Env } from "../env.js";
import { waitForProvisionDelay } from "../provision-delay.js";
import { apiBaseUrl, apiRateLimitBindings, webBaseUrl } from "../runtime.js";

const ASSERTION_TTL_SECONDS = 60 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const CLAIM_TTL_SECONDS = 10 * 60;

export type AgentAuthContext = AppContext;

export type AgentAuthRuntimeConfig = {
  issuer: string;
  secret: string;
  trustedProviders: ReturnType<typeof parseAgentAuthTrustedProviders>;
};

export function protectedResourceMetadata(env: Env) {
  return {
    resource: agentAuthResource(env),
    resource_name: "Agent Paste API",
    authorization_servers: [agentAuthIssuer(env)],
    scopes_supported: [...agentAuthScopes],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadata(env: Env) {
  const issuer = agentAuthIssuer(env);
  return {
    ...protectedResourceMetadata(env),
    issuer,
    token_endpoint: `${issuer}/oauth2/token`,
    revocation_endpoint: `${issuer}/oauth2/revoke`,
    grant_types_supported: [AGENT_AUTH_JWT_BEARER_GRANT_TYPE, AGENT_AUTH_CLAIM_GRANT_TYPE],
    agent_auth: {
      skill: `${issuer}/auth.md`,
      identity_endpoint: `${issuer}/agent/identity`,
      claim_endpoint: `${issuer}/agent/identity/claim`,
      events_endpoint: `${issuer}/agent/event/notify`,
      identity_types_supported: agentAuthIdentityTypes(env),
      identity_assertion: {
        assertion_types_supported: [AGENT_AUTH_ID_JAG_ASSERTION_TYPE],
      },
      events_supported: [AGENT_AUTH_REVOKED_EVENT],
    },
  };
}

export function protectedResourceMetadataUrl(env: Env): string {
  return `${agentAuthIssuer(env)}/.well-known/oauth-protected-resource`;
}

export function agentAuthSigningConfig(env: Env): AgentAuthRuntimeConfig | null {
  const secret = env.AGENT_AUTH_ASSERTION_SIGNING_SECRET;
  if (!secret) {
    return null;
  }
  return { issuer: agentAuthIssuer(env), secret, trustedProviders: agentAuthTrustedProviders(env) ?? [] };
}

export function agentAuthVerifiedConfig(env: Env): AgentAuthRuntimeConfig | null {
  const config = agentAuthSigningConfig(env);
  if (!config || config.trustedProviders.length === 0) {
    return null;
  }
  return config;
}

export function agentAuthIdentityTypes(env: Env): string[] {
  const config = agentAuthSigningConfig(env);
  if (!config) {
    return [];
  }
  return config.trustedProviders.length > 0 ? ["anonymous", "identity_assertion"] : ["anonymous"];
}

export function agentAuthIssuer(env: Env): string {
  return trimTrailingSlash(env.AGENT_AUTH_ISSUER ?? apiBaseUrl(env));
}

export function claimVerificationUri(env: Env, claimToken: string): string {
  return `${trimTrailingSlash(webBaseUrl(env))}/agent-auth/claim?claim_token=${encodeURIComponent(claimToken)}`;
}

export function claimAttemptVerificationUri(env: Env, claimAttemptToken: string): string {
  return `${trimTrailingSlash(webBaseUrl(env))}/agent-auth/claim?claim_attempt_token=${encodeURIComponent(
    claimAttemptToken,
  )}`;
}

export function assertionTtlSeconds(env: Env): number {
  return positiveInteger(env.AGENT_AUTH_ASSERTION_TTL_SECONDS, ASSERTION_TTL_SECONDS);
}

export function accessTokenTtlSeconds(env: Env): number {
  return positiveInteger(env.AGENT_AUTH_ACCESS_TOKEN_TTL_SECONDS, ACCESS_TOKEN_TTL_SECONDS);
}

export function claimTtlSeconds(env: Env): number {
  return positiveInteger(env.AGENT_AUTH_CLAIM_TTL_SECONDS, CLAIM_TTL_SECONDS);
}

export function secondsUntil(expiresAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
}

export async function readJson(context: AgentAuthContext): Promise<Record<string, unknown> | null> {
  try {
    const value = await context.req.json();
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function oauthError(
  context: AgentAuthContext,
  status: 400 | 401 | 429 | 503,
  error: string,
  errorDescription: string,
  headers?: Record<string, string>,
) {
  return context.json({ error, error_description: errorDescription }, status, headers);
}

export async function enforceAnonymousProvisionFriction(context: AgentAuthContext, env: Env): Promise<Response | null> {
  const rateLimit = await applyEphemeralProvisionRateLimit(
    apiRateLimitBindings(env),
    context.req.raw.headers.get("CF-Connecting-IP")?.trim() || undefined,
  );
  if (!rateLimit.ok) {
    return oauthError(context, 429, rateLimit.code, rateLimit.code, {
      "Retry-After": rateLimit.retryAfter,
    });
  }
  await waitForProvisionDelay(env.AGENT_AUTH_ANONYMOUS_DELAY_MS);
  return null;
}

function agentAuthTrustedProviders(env: Env): AgentAuthRuntimeConfig["trustedProviders"] | null {
  try {
    return parseAgentAuthTrustedProviders(env.AGENT_AUTH_TRUSTED_PROVIDERS_JSON);
  } catch (error) {
    console.warn(JSON.stringify({ event: "agent_auth_config_invalid", error: errorLabel(error) }));
    return null;
  }
}

function agentAuthResource(env: Env): string {
  return trimTrailingSlash(env.AGENT_AUTH_RESOURCE ?? apiBaseUrl(env));
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function errorLabel(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
