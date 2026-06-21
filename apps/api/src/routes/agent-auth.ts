import {
  AgentAuthVerificationError,
  mintAgentAuthServiceAssertion,
  type RequestIdVariables,
  verifyAgentAuthServiceAssertion,
  verifyAgentProviderIdentityAssertion,
  verifyAgentProviderSecurityEvent,
} from "@agent-paste/auth";
import {
  AGENT_AUTH_CLAIM_GRANT_TYPE,
  AGENT_AUTH_JWT_BEARER_GRANT_TYPE,
  AGENT_AUTH_REVOKED_EVENT,
  AgentIdentityRequest,
} from "@agent-paste/contracts";
import type { Repository } from "@agent-paste/db";
import { type BoundRespondersVariables, getBoundResponders } from "@agent-paste/worker-runtime";
import type { Hono } from "hono";
import { authenticateWebIdentity } from "../auth.js";
import type { Env } from "../env.js";
import {
  type AgentAuthContext,
  type AgentAuthRuntimeConfig,
  accessTokenTtlSeconds,
  agentAuthIdentityTypes,
  agentAuthIssuer,
  agentAuthSigningConfig,
  agentAuthVerifiedConfig,
  assertionTtlSeconds,
  authorizationServerMetadata,
  claimAttemptVerificationUri,
  claimTtlSeconds,
  claimVerificationUri,
  enforceAnonymousProvisionFriction,
  oauthError,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  readJson,
  secondsUntil,
} from "./agent-auth-support.js";

const CLAIM_POLL_INTERVAL_SECONDS = 5;

export function mountAgentAuthRoutes(
  app: Hono<{ Bindings: Env; Variables: RequestIdVariables & BoundRespondersVariables }>,
  resolveDatabase: (env: Env) => Repository | undefined,
) {
  app.get("/auth.md", (context) => authMd(context as AgentAuthContext));
  app.get("/.well-known/oauth-protected-resource", (context) =>
    context.json(protectedResourceMetadata(context.env as Env)),
  );
  app.get("/.well-known/oauth-authorization-server", (context) =>
    context.json(authorizationServerMetadata(context.env as Env)),
  );
  app.post("/agent/identity", (context) => agentIdentity(context as AgentAuthContext, resolveDatabase));
  app.post("/agent/identity/claim", (context) => agentIdentityClaim(context as AgentAuthContext, resolveDatabase));
  app.post("/oauth2/token", (context) => oauthToken(context as AgentAuthContext, resolveDatabase));
  app.post("/oauth2/revoke", (context) => oauthRevoke(context as AgentAuthContext, resolveDatabase));
  app.post("/agent/event/notify", (context) => agentEventNotify(context as AgentAuthContext, resolveDatabase));
  app.post("/v1/web/agent-auth/claim/complete", (context) =>
    webAgentAuthClaimComplete(context as AgentAuthContext, resolveDatabase),
  );
}

export function agentAuthWwwAuthenticateMiddleware() {
  return async (context: AgentAuthContext, next: () => Promise<void>) => {
    await next();
    if (context.res.status === 401 && !context.res.headers.has("WWW-Authenticate")) {
      context.res.headers.set(
        "WWW-Authenticate",
        `Bearer resource_metadata="${protectedResourceMetadataUrl(context.env)}"`,
      );
    }
  };
}

function authMd(context: AgentAuthContext) {
  const env = context.env as Env;
  const metadataUrl = protectedResourceMetadataUrl(env);
  const identityUrl = `${agentAuthIssuer(env)}/agent/identity`;
  const supported = agentAuthIdentityTypes(env).join(", ") || "none until configured";
  return context.text(
    [
      "# Agent Paste agent auth",
      "",
      "Agent Paste lets agents register with WorkOS auth.md verified and user-claimed flows.",
      "",
      `Protected Resource Metadata: ${metadataUrl}`,
      `Agent identity endpoint: ${identityUrl}`,
      "",
      `Supported registration types: ${supported}`,
      "",
      "Scopes:",
      "- read: inspect account and Artifact metadata.",
      "- publish: publish and revise Artifacts.",
      "",
      "Agent Paste does not support service_auth agent registration.",
    ].join("\n"),
    200,
    { "content-type": "text/markdown; charset=utf-8" },
  );
}

async function agentIdentity(context: AgentAuthContext, resolveDatabase: (env: Env) => Repository | undefined) {
  const env = context.env as Env;
  const config = agentAuthSigningConfig(env);
  if (!config) {
    return oauthError(context, 503, "temporarily_unavailable", "Agent auth is not configured.");
  }
  const db = resolveDatabase(env);
  if (!db) {
    return oauthError(context, 503, "server_error", "Database unavailable.");
  }

  const parsed = AgentIdentityRequest.safeParse(await readJson(context));
  if (!parsed.success) {
    return oauthError(context, 400, "invalid_request", "Invalid identity request.");
  }

  if (parsed.data.type === "anonymous") {
    const rateLimited = await enforceAnonymousProvisionFriction(context, env);
    if (rateLimited) {
      return rateLimited;
    }
    const result = await db.registerAgentAnonymousIdentity({
      audience: config.issuer,
    });
    return anonymousIdentitySuccessResponse(context, config, result);
  }

  if (config.trustedProviders.length === 0) {
    return oauthError(context, 503, "temporarily_unavailable", "Agent verified auth is not configured.");
  }

  try {
    const verified = await verifyAgentProviderIdentityAssertion(parsed.data.assertion, {
      audience: config.issuer,
      trustedProviders: config.trustedProviders,
      maxAuthAgeSeconds: 60 * 60,
    });
    const result = await db.registerAgentVerifiedIdentity({
      providerIssuer: verified.issuer,
      providerSubject: verified.subject,
      audience: verified.audience,
      providerClientId: verified.clientId,
      email: verified.email,
      jti: verified.jti,
      jtiExpiresAt: verified.expiresAt,
      assertionExpiresInSeconds: assertionTtlSeconds(env),
      claimExpiresInSeconds: claimTtlSeconds(env),
    });

    if (result.kind === "replay_detected") {
      return oauthError(context, 400, "replay_detected", "Assertion replay detected.");
    }
    if (result.kind === "ambiguous_email") {
      return oauthError(context, 400, "invalid_request", "The asserted email is ambiguous.");
    }
    if (result.kind === "interaction_required") {
      return stepUpResponse(context, env, result);
    }
    return identitySuccessResponse(context, config, result.registration);
  } catch (error) {
    return agentAuthVerificationError(context, error);
  }
}

async function agentIdentityClaim(context: AgentAuthContext, resolveDatabase: (env: Env) => Repository | undefined) {
  const env = context.env as Env;
  const db = resolveDatabase(env);
  if (!db) {
    return oauthError(context, 503, "server_error", "Database unavailable.");
  }
  const body = await readJson(context);
  const claimToken = typeof body?.claim_token === "string" ? body.claim_token : "";
  if (claimToken) {
    const started = await db.startAgentAuthAnonymousClaim({
      claimToken,
      claimAttemptExpiresInSeconds: claimTtlSeconds(env),
    });
    if (started.kind === "expired_token") {
      return oauthError(context, 400, "expired_token", "Claim token is expired or unknown.");
    }
    if (started.kind === "initiated") {
      return context.json({
        claim_token: claimToken,
        claim_token_expires: started.claim_token_expires_at,
        claim_attempt_token: started.claim_attempt_token,
        registration_id: started.registration.id,
        registration_type: "anonymous",
        claim: {
          user_code: started.user_code,
          expires_in: secondsUntil(started.claim_attempt_expires_at),
          verification_uri: claimAttemptVerificationUri(env, started.claim_attempt_token),
          interval: CLAIM_POLL_INTERVAL_SECONDS,
        },
      });
    }
  }
  const claim = claimToken ? await db.getAgentAuthClaim({ claimToken }) : null;
  if (!claim) {
    return oauthError(context, 400, "expired_token", "Claim token is expired or unknown.");
  }
  return context.json({
    claim_token: claimToken,
    claim_token_expires: claim.expires_at,
    claim: {
      expires_in: secondsUntil(claim.expires_at),
      verification_uri: claimVerificationUri(context.env as Env, claimToken),
      interval: CLAIM_POLL_INTERVAL_SECONDS,
    },
  });
}

async function oauthToken(context: AgentAuthContext, resolveDatabase: (env: Env) => Repository | undefined) {
  const env = context.env as Env;
  const config = agentAuthSigningConfig(env);
  if (!config) {
    return oauthError(context, 503, "temporarily_unavailable", "Agent auth is not configured.");
  }
  const db = resolveDatabase(env);
  if (!db) {
    return oauthError(context, 503, "server_error", "Database unavailable.");
  }
  const form = new URLSearchParams(await context.req.text());
  const grantType = form.get("grant_type");
  if (grantType === AGENT_AUTH_JWT_BEARER_GRANT_TYPE) {
    const assertion = form.get("assertion");
    if (!assertion) {
      return oauthError(context, 400, "invalid_request", "Missing assertion.");
    }
    const payload = await verifyAgentAuthServiceAssertion({
      assertion,
      issuer: config.issuer,
      secret: config.secret,
    });
    if (!payload) {
      return oauthError(context, 400, "invalid_grant", "Invalid identity assertion.");
    }
    const result = await db.exchangeAgentAuthIdentityAssertion({
      registrationId: payload.registration_id,
      ...(payload.anonymous_claim_state ? { anonymousClaimState: payload.anonymous_claim_state } : {}),
      accessTokenExpiresInSeconds: accessTokenTtlSeconds(env),
    });
    return tokenExchangeResponse(context, result);
  }
  if (grantType === AGENT_AUTH_CLAIM_GRANT_TYPE) {
    const claimToken = form.get("claim_token");
    if (!claimToken) {
      return oauthError(context, 400, "invalid_request", "Missing claim_token.");
    }
    const result = await db.exchangeAgentAuthClaimToken({
      claimToken,
      accessTokenExpiresInSeconds: accessTokenTtlSeconds(env),
    });
    if (result.kind !== "issued") {
      return tokenExchangeResponse(context, result);
    }
    const identityAssertion = await mintAgentAuthServiceAssertion({
      issuer: config.issuer,
      secret: config.secret,
      registrationId: result.registration.id,
      registrationType: result.registration.registration_type,
      ...(result.registration.registration_type === "anonymous" ? { anonymousClaimState: "post_claim" } : {}),
      scopes: result.registration.scopes,
      expiresAt: new Date(result.registration.expires_at),
    });
    return context.json({
      access_token: result.access_token,
      token_type: "Bearer",
      expires_in: result.expires_in,
      scope: result.registration.scopes.join(" "),
      identity_assertion: identityAssertion,
      assertion_expires: result.registration.expires_at,
    });
  }
  return oauthError(context, 400, "unsupported_grant_type", "Unsupported grant_type.");
}

async function oauthRevoke(context: AgentAuthContext, resolveDatabase: (env: Env) => Repository | undefined) {
  const db = resolveDatabase(context.env as Env);
  if (!db) {
    return oauthError(context, 503, "server_error", "Database unavailable.");
  }
  const form = new URLSearchParams(await context.req.text());
  const token = form.get("token");
  if (token) {
    await db.revokeAgentAuthAccessToken({ token });
  }
  return context.body(null, 200);
}

async function agentEventNotify(context: AgentAuthContext, resolveDatabase: (env: Env) => Repository | undefined) {
  const env = context.env as Env;
  const config = agentAuthVerifiedConfig(env);
  if (!config) {
    return oauthError(context, 503, "temporarily_unavailable", "Agent auth is not configured.");
  }
  const db = resolveDatabase(env);
  if (!db) {
    return oauthError(context, 503, "server_error", "Database unavailable.");
  }
  try {
    const event = await verifyAgentProviderSecurityEvent(await context.req.text(), {
      audience: config.issuer,
      trustedProviders: config.trustedProviders,
    });
    if (event.eventTypes.includes(AGENT_AUTH_REVOKED_EVENT)) {
      const result = await db.revokeAgentAuthProviderIdentity({
        providerIssuer: event.issuer,
        providerSubject: event.subject,
        audience: event.audience,
        jti: event.jti,
        jtiExpiresAt: event.expiresAt,
      });
      if (result === "replay_detected") {
        return context.json({ err: "replay_detected", description: "SET replay detected." }, 400);
      }
    }
    return context.body(null, 202);
  } catch (error) {
    if (error instanceof AgentAuthVerificationError) {
      return context.json({ err: error.code, description: error.message }, 400);
    }
    return context.json({ err: "invalid_request", description: "Invalid security event." }, 400);
  }
}

async function webAgentAuthClaimComplete(
  context: AgentAuthContext,
  resolveDatabase: (env: Env) => Repository | undefined,
) {
  const env = context.env as Env;
  const identity = await authenticateWebIdentity(context.req.raw, env);
  if (!identity) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const db = resolveDatabase(env);
  if (!db) {
    return getBoundResponders(context).respondError("database_unavailable");
  }
  const body = await readJson(context);
  const claimToken = typeof body?.claim_token === "string" ? body.claim_token.trim() : "";
  const claimAttemptToken = typeof body?.claim_attempt_token === "string" ? body.claim_attempt_token.trim() : "";
  const userCode = typeof body?.user_code === "string" ? body.user_code.trim() : "";
  if ((!claimToken && !claimAttemptToken) || !/^\d{6}$/.test(userCode)) {
    return getBoundResponders(context).respondError("invalid_request", "Invalid claim request.");
  }
  const actor = await db.ensureWebMember({ workosUserId: identity.workos_user_id, email: identity.email });
  const completed = claimAttemptToken
    ? await db.completeAgentAuthAnonymousClaim({ actor, claimAttemptToken, userCode })
    : await db.completeAgentAuthClaim({ actor, claimToken, userCode });
  if (!completed) {
    return getBoundResponders(context).respondError("invalid_request", "Claim code did not match.");
  }
  return context.json({ ok: true, registration_id: completed.id });
}

async function identitySuccessResponse(
  context: AgentAuthContext,
  config: AgentAuthRuntimeConfig,
  registration: {
    id: string;
    registration_type: "identity_assertion" | "anonymous";
    expires_at: string;
    scopes: string[];
  },
) {
  const assertion = await mintAgentAuthServiceAssertion({
    issuer: config.issuer,
    secret: config.secret,
    registrationId: registration.id,
    registrationType: registration.registration_type,
    scopes: registration.scopes,
    expiresAt: new Date(registration.expires_at),
  });
  return context.json({
    registration_id: registration.id,
    registration_type: registration.registration_type,
    identity_assertion: assertion,
    assertion_expires: registration.expires_at,
    scopes: registration.scopes,
  });
}

async function anonymousIdentitySuccessResponse(
  context: AgentAuthContext,
  config: AgentAuthRuntimeConfig,
  result: Extract<Awaited<ReturnType<Repository["registerAgentAnonymousIdentity"]>>, { kind: "registered" }>,
) {
  const assertion = await mintAgentAuthServiceAssertion({
    issuer: config.issuer,
    secret: config.secret,
    registrationId: result.registration.id,
    registrationType: "anonymous",
    scopes: result.registration.scopes,
    expiresAt: new Date(result.registration.expires_at),
  });
  return context.json({
    registration_id: result.registration.id,
    registration_type: "anonymous",
    identity_assertion: assertion,
    assertion_expires: result.registration.expires_at,
    scopes: result.registration.scopes,
    claim_url: `${agentAuthIssuer(context.env as Env)}/agent/identity/claim`,
    claim_token: result.claim_token,
    claim_token_expires: result.claim_expires_at,
    pre_claim_scopes: result.registration.scopes,
    post_claim_scopes: result.registration.scopes,
  });
}

async function stepUpResponse(
  context: AgentAuthContext,
  env: Env,
  result: Extract<Awaited<ReturnType<Repository["registerAgentVerifiedIdentity"]>>, { kind: "interaction_required" }>,
) {
  const body = {
    error: "interaction_required",
    error_description: "User confirmation is required before linking this agent identity.",
    registration_id: result.registration.id,
    registration_type: "identity_assertion",
    claim_url: `${agentAuthIssuer(env)}/agent/identity/claim`,
    claim_token: result.claim_token,
    claim_token_expires: result.claim_expires_at,
    post_claim_scopes: result.registration.scopes,
    claim: {
      user_code: result.user_code,
      expires_in: secondsUntil(result.claim_expires_at),
      verification_uri: claimVerificationUri(env, result.claim_token),
      interval: CLAIM_POLL_INTERVAL_SECONDS,
    },
  };
  return context.json(body, 401, {
    "WWW-Authenticate": 'AgentAuth error="interaction_required", error_description="User confirmation is required."',
  });
}

function tokenExchangeResponse(
  context: AgentAuthContext,
  result: Awaited<ReturnType<Repository["exchangeAgentAuthClaimToken"]>>,
) {
  if (result.kind === "issued") {
    return context.json({
      access_token: result.access_token,
      token_type: "Bearer",
      expires_in: result.expires_in,
      scope: result.registration.scopes.join(" "),
    });
  }
  if (result.kind === "authorization_pending") {
    return oauthError(context, 400, "authorization_pending", "Claim has not been completed.");
  }
  if (result.kind === "expired_token") {
    return oauthError(context, 400, "expired_token", "The assertion or claim token is expired.");
  }
  return oauthError(context, 400, "invalid_grant", "Invalid grant.");
}

function agentAuthVerificationError(context: AgentAuthContext, error: unknown) {
  if (error instanceof AgentAuthVerificationError) {
    if (error.code === "login_required") {
      return context.json(
        {
          error: "login_required",
          error_description: "The provider authentication is too old.",
          max_age: error.maxAge ?? 60 * 60,
        },
        401,
        {
          "WWW-Authenticate": `AgentAuth error="login_required", max_age="${error.maxAge ?? 60 * 60}"`,
        },
      );
    }
    return oauthError(context, 400, error.code, error.message);
  }
  return oauthError(context, 400, "invalid_request", "Invalid identity assertion.");
}
