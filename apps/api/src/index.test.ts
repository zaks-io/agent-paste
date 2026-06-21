import { mintAgentAuthServiceAssertion } from "@agent-paste/auth";
import { IdempotencyInFlightError } from "@agent-paste/commands";
import {
  AGENT_AUTH_CLAIM_GRANT_TYPE,
  AGENT_AUTH_ID_JAG_ASSERTION_TYPE,
  AGENT_AUTH_JWT_BEARER_GRANT_TYPE,
  routeContracts,
} from "@agent-paste/contracts";
import { mintAccessLinkBlob } from "@agent-paste/tokens/access-link";
import { mintAgentViewToken } from "@agent-paste/tokens/agent-view";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  type ApiDatabase,
  type Env,
  mountedRouteIds,
  nonContractRoutePaths,
  handleRequest as rawHandleRequest,
} from "./index.js";

function allowRateLimits(): Pick<Env, "ACTOR_RATE_LIMIT" | "WORKSPACE_BURST_CAP" | "ARTIFACT_RATE_LIMIT"> {
  return {
    ACTOR_RATE_LIMIT: { limit: async () => ({ success: true }) },
    WORKSPACE_BURST_CAP: { limit: async () => ({ success: true }) },
    ARTIFACT_RATE_LIMIT: { limit: async () => ({ success: true }) },
  };
}

function handleRequest(request: Request, env: Env = {}): Promise<Response> {
  return rawHandleRequest(request, { ...allowRateLimits(), ...env });
}

async function expectAgentAuthError(request: Request, env: Env, status: number, error: string): Promise<Response> {
  const response = await handleRequest(request, env);
  expect(response.status, await response.clone().text()).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error });
  return response;
}

function agentRegistration(id: string, registrationType: "identity_assertion" | "anonymous") {
  return {
    id,
    registration_type: registrationType,
    expires_at: "2099-06-20T13:00:00.000Z",
    scopes: ["read", "publish"],
  };
}

function postAgentIdentity(env: Env, assertion: string): Promise<Response> {
  return handleRequest(
    new Request("https://api.test/agent/identity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "identity_assertion", assertion_type: AGENT_AUTH_ID_JAG_ASSERTION_TYPE, assertion }),
    }),
    env,
  );
}

function postToken(env: Env, form: Record<string, string>): Promise<Response> {
  return handleRequest(
    new Request("https://api.test/oauth2/token", {
      method: "POST",
      body: new URLSearchParams(form),
    }),
    env,
  );
}

async function providerJwtFixture() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const kid = `kid-${crypto.randomUUID()}`;
  jwk.kid = kid;
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } }),
    );
  const provider = {
    issuer: "https://provider.example",
    displayName: "Provider",
    jwksUri: `https://provider.example/${kid}/jwks.json`,
    clientIds: ["client_1"],
    algorithms: ["RS256"],
  };
  return {
    provider,
    restore: () => fetchSpy.mockRestore(),
    sign: (
      jti: string,
      options: {
        typ?: "oauth-id-jag+jwt" | "secevent+jwt";
        payload?: Record<string, unknown>;
      } = {},
    ) => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      return new SignJWT({
        client_id: "client_1",
        auth_time: nowSeconds,
        email: "person@example.test",
        email_verified: true,
        ...options.payload,
      })
        .setProtectedHeader({ alg: "RS256", typ: options.typ ?? "oauth-id-jag+jwt", kid })
        .setIssuer(provider.issuer)
        .setAudience("https://api.test")
        .setSubject("user_123")
        .setJti(jti)
        .setIssuedAt(nowSeconds)
        .setExpirationTime(nowSeconds + 300)
        .sign(privateKey);
    },
  };
}

function billingEnv(): Pick<Env, "BILLING_ENABLED"> {
  return { BILLING_ENABLED: "true" };
}

describe("api worker", () => {
  it("mounts every api route contract", () => {
    expect([...mountedRouteIds].sort()).toEqual(
      routeContracts
        .filter((route) => route.app === "api")
        .map((route) => route.id)
        .sort(),
    );
    expect([...nonContractRoutePaths]).toEqual([
      "/healthz",
      "/openapi.json",
      "/auth.md",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-authorization-server",
      "/agent/identity",
      "/agent/identity/claim",
      "/oauth2/token",
      "/oauth2/revoke",
      "/agent/event/notify",
      "/v1/web/agent-auth/claim/complete",
      "/__test__/provision-smoke",
      "/__test__/force-expire",
      "/__test__/delete-artifact",
      "/__test__/r2-list",
      "/__test__/denylist",
      "/v1/internal/live-updates/authorize",
    ]);
  });

  it("GET /healthz returns 200 with no cookies", async () => {
    const response = await handleRequest(new Request("https://api.test/healthz"), {});
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("publishes agent auth discovery metadata", async () => {
    const env: Env = {
      API_BASE_URL: "https://api.test",
      AGENT_AUTH_ASSERTION_SIGNING_SECRET: "secret",
      AGENT_AUTH_TRUSTED_PROVIDERS_JSON: JSON.stringify([
        { issuer: "https://provider.test", display_name: "Provider", client_ids: ["client_1"] },
      ]),
    };
    const prm = await handleRequest(new Request("https://api.test/.well-known/oauth-protected-resource"), env);
    expect(prm.status).toBe(200);
    await expect(prm.json()).resolves.toMatchObject({
      resource: "https://api.test",
      authorization_servers: ["https://api.test"],
      scopes_supported: ["read", "publish"],
    });

    const as = await handleRequest(new Request("https://api.test/.well-known/oauth-authorization-server"), env);
    expect(as.status).toBe(200);
    await expect(as.json()).resolves.toMatchObject({
      issuer: "https://api.test",
      token_endpoint: "https://api.test/oauth2/token",
      agent_auth: {
        identity_endpoint: "https://api.test/agent/identity",
        events_endpoint: "https://api.test/agent/event/notify",
        events_supported: ["https://schemas.workos.com/events/agent/auth/identity/assertion/revoked"],
        identity_assertion: {
          assertion_types_supported: ["urn:ietf:params:oauth:token-type:id-jag"],
        },
        identity_types_supported: ["anonymous", "identity_assertion"],
      },
    });

    const authMd = await handleRequest(new Request("https://api.test/auth.md"), env);
    expect(authMd.status).toBe(200);
    const body = await authMd.text();
    expect(body).toContain('POST /agent/identity with {"type":"anonymous"}');
    expect(body).toContain("grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(body).toContain("claim_url from /agent/identity is the API claim endpoint");
    expect(body).toContain("claim.verification_uri from /agent/identity/claim is the browser URL");
    expect(body).toContain("authorization_pending");
    expect(body).toContain("The signed-in browser session determines the destination Agent Paste Workspace.");
    expect(body).toContain("Agent Paste does not support service_auth agent registration.");
  });

  it("advertises anonymous agent auth with only a signing secret", async () => {
    const env: Env = {
      API_BASE_URL: "https://api.test",
      AGENT_AUTH_ASSERTION_SIGNING_SECRET: "secret",
    };
    const as = await handleRequest(new Request("https://api.test/.well-known/oauth-authorization-server"), env);
    expect(as.status).toBe(200);
    const metadata = await as.json();
    expect(metadata).toMatchObject({
      agent_auth: {
        identity_types_supported: ["anonymous"],
      },
    });
    expect(metadata.agent_auth).not.toHaveProperty("events_endpoint");
    expect(metadata.agent_auth).not.toHaveProperty("events_supported");
    expect(metadata.agent_auth).not.toHaveProperty("identity_assertion");
  });

  it("registers an anonymous agent identity behind ephemeral provision rate limits", async () => {
    const calls: string[] = [];
    const response = await handleRequest(
      new Request("https://api.test/agent/identity", {
        method: "POST",
        headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
        body: JSON.stringify({ type: "anonymous" }),
      }),
      {
        API_BASE_URL: "https://api.test",
        AGENT_AUTH_ASSERTION_SIGNING_SECRET: "secret",
        AGENT_AUTH_ANONYMOUS_DELAY_MS: "0",
        EPHEMERAL_PROVISION_GLOBAL_RATE_LIMIT: {
          async limit({ key }) {
            calls.push(`global:${key}`);
            return { success: true };
          },
        },
        EPHEMERAL_PROVISION_IP_RATE_LIMIT: {
          async limit({ key }) {
            calls.push(`ip:${key}`);
            return { success: true };
          },
        },
        DB: {
          async getWhoami() {
            return {};
          },
          async registerAgentAnonymousIdentity() {
            return {
              kind: "registered",
              registration: {
                id: "reg_anon",
                registration_type: "anonymous",
                expires_at: "2099-06-20T12:00:00.000Z",
                scopes: ["read", "publish"],
              },
              claim_token: "ap_ct_preview_claim",
              claim_expires_at: "2099-06-20T12:00:00.000Z",
            };
          },
        } as Partial<ApiDatabase> as ApiDatabase,
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(calls).toEqual(["global:global", "ip:203.0.113.10"]);
    await expect(response.json()).resolves.toMatchObject({
      registration_id: "reg_anon",
      registration_type: "anonymous",
      claim_token: "ap_ct_preview_claim",
      claim_url: "https://api.test/agent/identity/claim",
      pre_claim_scopes: ["read", "publish"],
      post_claim_scopes: ["read", "publish"],
    });
  });

  it("starts an anonymous agent claim without collecting email", async () => {
    const response = await handleRequest(
      new Request("https://api.test/agent/identity/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claim_token: "ap_ct_preview_claim" }),
      }),
      {
        WEB_BASE_URL: "https://app.test",
        DB: {
          async getWhoami() {
            return {};
          },
          async startAgentAuthAnonymousClaim(input) {
            expect(input).toEqual({
              claimToken: "ap_ct_preview_claim",
              claimAttemptExpiresInSeconds: 600,
            });
            return {
              kind: "initiated",
              registration: {
                id: "reg_anon",
                registration_type: "anonymous",
                expires_at: "2099-06-20T12:00:00.000Z",
                scopes: ["read", "publish"],
              },
              claim_token_expires_at: "2099-06-20T12:00:00.000Z",
              claim_attempt_token: "attempt_123",
              user_code: "123456",
              claim_attempt_expires_at: "2099-06-20T12:10:00.000Z",
            };
          },
        } as Partial<ApiDatabase> as ApiDatabase,
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      claim_token: "ap_ct_preview_claim",
      claim_attempt_token: "attempt_123",
      registration_id: "reg_anon",
      registration_type: "anonymous",
      claim: {
        user_code: "123456",
        verification_uri: "https://app.test/agent-auth/claim?claim_attempt_token=attempt_123",
      },
    });
  });

  it("handles agent identity request errors and rate-limit rejection", async () => {
    await expectAgentAuthError(
      new Request("https://api.test/agent/identity", { method: "POST", body: "{}" }),
      {},
      503,
      "temporarily_unavailable",
    );
    await expectAgentAuthError(
      new Request("https://api.test/agent/identity", { method: "POST", body: "not json" }),
      { AGENT_AUTH_ASSERTION_SIGNING_SECRET: "secret", DB: baseDbForTests() },
      400,
      "invalid_request",
    );
    await expectAgentAuthError(
      new Request("https://api.test/agent/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "identity_assertion",
          assertion_type: AGENT_AUTH_ID_JAG_ASSERTION_TYPE,
          assertion: "jwt",
        }),
      }),
      { AGENT_AUTH_ASSERTION_SIGNING_SECRET: "secret", DB: baseDbForTests() },
      503,
      "temporarily_unavailable",
    );

    const rateLimited = await handleRequest(
      new Request("https://api.test/agent/identity", {
        method: "POST",
        headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
        body: JSON.stringify({ type: "anonymous" }),
      }),
      {
        AGENT_AUTH_ASSERTION_SIGNING_SECRET: "secret",
        EPHEMERAL_PROVISION_GLOBAL_RATE_LIMIT: {
          async limit() {
            return { success: false };
          },
        },
        DB: {
          ...baseDbForTests(),
          async registerAgentAnonymousIdentity() {
            throw new Error("rate limited requests should not provision");
          },
        } as Partial<ApiDatabase> as ApiDatabase,
      },
    );
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get("retry-after")).toBe("3600");
    await expect(rateLimited.json()).resolves.toMatchObject({ error: "ephemeral_provision_rate_limited" });
  });

  it("maps verified agent identity registration outcomes", async () => {
    const fixture = await providerJwtFixture();
    try {
      const outcomes = [
        { kind: "replay_detected" as const },
        { kind: "ambiguous_email" as const },
        { kind: "provision_failed" as const },
        {
          kind: "interaction_required" as const,
          registration: agentRegistration("reg_step_up", "identity_assertion"),
          claim_token: "claim_step_up",
          user_code: "123456",
          claim_expires_at: "2099-06-20T12:10:00.000Z",
        },
        { kind: "verified" as const, registration: agentRegistration("reg_verified", "identity_assertion") },
      ];
      const registerAgentVerifiedIdentity = vi.fn(async () => outcomes.shift());
      const env: Env = {
        API_BASE_URL: "https://api.test",
        WEB_BASE_URL: "https://app.test",
        AGENT_AUTH_ASSERTION_SIGNING_SECRET: "secret",
        AGENT_AUTH_TRUSTED_PROVIDERS_JSON: JSON.stringify([
          {
            issuer: fixture.provider.issuer,
            display_name: fixture.provider.displayName,
            jwks_uri: fixture.provider.jwksUri,
            client_ids: fixture.provider.clientIds,
            algorithms: fixture.provider.algorithms,
          },
        ]),
        DB: {
          ...baseDbForTests(),
          registerAgentVerifiedIdentity,
        } as Partial<ApiDatabase> as ApiDatabase,
      };

      const replay = await postAgentIdentity(env, await fixture.sign("jti_replay"));
      expect(replay.status).toBe(400);
      await expect(replay.json()).resolves.toMatchObject({ error: "replay_detected" });

      const ambiguous = await postAgentIdentity(env, await fixture.sign("jti_ambiguous"));
      expect(ambiguous.status).toBe(400);
      await expect(ambiguous.json()).resolves.toMatchObject({ error: "invalid_request" });

      const provisionFailed = await postAgentIdentity(env, await fixture.sign("jti_failed"));
      expect(provisionFailed.status).toBe(503);
      await expect(provisionFailed.json()).resolves.toMatchObject({ error: "server_error" });

      const stepUp = await postAgentIdentity(env, await fixture.sign("jti_step_up"));
      expect(stepUp.status).toBe(401);
      expect(stepUp.headers.get("www-authenticate")).toContain("interaction_required");
      await expect(stepUp.json()).resolves.toMatchObject({
        error: "interaction_required",
        claim: { user_code: "123456", verification_uri: "https://app.test/agent-auth/claim?claim_token=claim_step_up" },
      });

      const verified = await postAgentIdentity(env, await fixture.sign("jti_verified"));
      expect(verified.status).toBe(200);
      await expect(verified.json()).resolves.toMatchObject({
        registration_id: "reg_verified",
        registration_type: "identity_assertion",
        scopes: ["read", "publish"],
      });
      expect(registerAgentVerifiedIdentity).toHaveBeenCalledTimes(5);
    } finally {
      fixture.restore();
    }
  });

  it("handles agent claim lookup and token exchange outcomes", async () => {
    const registration = agentRegistration("reg_anon", "anonymous");
    const assertion = await mintAgentAuthServiceAssertion({
      issuer: "https://api.test",
      secret: "secret",
      registrationId: registration.id,
      registrationType: "anonymous",
      scopes: registration.scopes,
      expiresAt: new Date(registration.expires_at),
      now: new Date("2099-06-20T12:00:00.000Z"),
    });
    const exchangeAgentAuthClaimToken = vi
      .fn()
      .mockResolvedValueOnce({ kind: "authorization_pending" })
      .mockResolvedValueOnce({ kind: "expired_token" })
      .mockResolvedValueOnce({ kind: "invalid_grant" })
      .mockResolvedValueOnce({ kind: "issued", access_token: "claimed_token", expires_in: 3600, registration });
    const revokeAgentAuthAccessToken = vi.fn(async () => true);
    const env: Env = {
      API_BASE_URL: "https://api.test",
      WEB_BASE_URL: "https://app.test",
      AGENT_AUTH_ASSERTION_SIGNING_SECRET: "secret",
      DB: {
        ...baseDbForTests(),
        async startAgentAuthAnonymousClaim() {
          return { kind: "invalid_grant" };
        },
        async getAgentAuthClaim() {
          return {
            registration_id: "reg_verified",
            registration_type: "identity_assertion",
            email: "person@example.test",
            provider_issuer: "https://provider.example",
            provider_client_id: "client_1",
            expires_at: "2099-06-20T12:10:00.000Z",
            completed_at: null,
          };
        },
        async exchangeAgentAuthIdentityAssertion() {
          return { kind: "issued", access_token: "pre_claim_token", expires_in: 3600, registration };
        },
        exchangeAgentAuthClaimToken,
        revokeAgentAuthAccessToken,
      } as Partial<ApiDatabase> as ApiDatabase,
    };

    const claim = await handleRequest(
      new Request("https://api.test/agent/identity/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claim_token: "claim_verified" }),
      }),
      env,
    );
    expect(claim.status).toBe(200);
    await expect(claim.json()).resolves.toMatchObject({
      claim: { verification_uri: "https://app.test/agent-auth/claim?claim_token=claim_verified" },
    });

    const jwtBearer = await postToken(env, { grant_type: AGENT_AUTH_JWT_BEARER_GRANT_TYPE, assertion });
    expect(jwtBearer.status).toBe(200);
    await expect(jwtBearer.json()).resolves.toMatchObject({ access_token: "pre_claim_token" });

    await expectAgentAuthError(
      new Request("https://api.test/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({ grant_type: AGENT_AUTH_JWT_BEARER_GRANT_TYPE }),
      }),
      env,
      400,
      "invalid_request",
    );
    await expectAgentAuthError(
      new Request("https://api.test/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({ grant_type: AGENT_AUTH_JWT_BEARER_GRANT_TYPE, assertion: "bad" }),
      }),
      env,
      400,
      "invalid_grant",
    );
    await expectAgentAuthError(
      new Request("https://api.test/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({ grant_type: AGENT_AUTH_CLAIM_GRANT_TYPE }),
      }),
      env,
      400,
      "invalid_request",
    );

    await expectAgentAuthError(
      new Request("https://api.test/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({ grant_type: AGENT_AUTH_CLAIM_GRANT_TYPE, claim_token: "claim_1" }),
      }),
      env,
      400,
      "authorization_pending",
    );
    await expectAgentAuthError(
      new Request("https://api.test/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({ grant_type: AGENT_AUTH_CLAIM_GRANT_TYPE, claim_token: "claim_2" }),
      }),
      env,
      400,
      "expired_token",
    );
    await expectAgentAuthError(
      new Request("https://api.test/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({ grant_type: AGENT_AUTH_CLAIM_GRANT_TYPE, claim_token: "claim_3" }),
      }),
      env,
      400,
      "invalid_grant",
    );

    const claimed = await postToken(env, { grant_type: AGENT_AUTH_CLAIM_GRANT_TYPE, claim_token: "claim_4" });
    expect(claimed.status).toBe(200);
    await expect(claimed.json()).resolves.toMatchObject({
      access_token: "claimed_token",
      identity_assertion: expect.any(String),
    });

    await expectAgentAuthError(
      new Request("https://api.test/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({ grant_type: "unsupported" }),
      }),
      env,
      400,
      "unsupported_grant_type",
    );

    const revoke = await handleRequest(
      new Request("https://api.test/oauth2/revoke", {
        method: "POST",
        body: new URLSearchParams({ token: "claimed_token" }),
      }),
      env,
    );
    expect(revoke.status).toBe(200);
    expect(revokeAgentAuthAccessToken).toHaveBeenCalledWith({ token: "claimed_token" });
  });

  it("handles agent security event notification outcomes", async () => {
    await expectAgentAuthError(
      new Request("https://api.test/agent/event/notify", { method: "POST", body: "event" }),
      { AGENT_AUTH_ASSERTION_SIGNING_SECRET: "secret" },
      503,
      "temporarily_unavailable",
    );

    const fixture = await providerJwtFixture();
    try {
      const trustedEnv: Env = {
        API_BASE_URL: "https://api.test",
        AGENT_AUTH_ASSERTION_SIGNING_SECRET: "secret",
        AGENT_AUTH_TRUSTED_PROVIDERS_JSON: JSON.stringify([
          {
            issuer: fixture.provider.issuer,
            display_name: fixture.provider.displayName,
            jwks_uri: fixture.provider.jwksUri,
            client_ids: fixture.provider.clientIds,
            algorithms: fixture.provider.algorithms,
          },
        ]),
      };
      const eventPayload = {
        events: { "https://schemas.workos.com/events/agent/auth/identity/assertion/revoked": {} },
      };

      await expectAgentAuthError(
        new Request("https://api.test/agent/event/notify", {
          method: "POST",
          body: await fixture.sign("set_db_missing", { typ: "secevent+jwt", payload: eventPayload }),
        }),
        trustedEnv,
        503,
        "server_error",
      );

      const invalid = await handleRequest(
        new Request("https://api.test/agent/event/notify", { method: "POST", body: "not.jwt" }),
        { ...trustedEnv, DB: baseDbForTests() },
      );
      expect(invalid.status).toBe(400);
      await expect(invalid.json()).resolves.toMatchObject({ err: "invalid_request" });

      const replay = await handleRequest(
        new Request("https://api.test/agent/event/notify", {
          method: "POST",
          body: await fixture.sign("set_replay", { typ: "secevent+jwt", payload: eventPayload }),
        }),
        {
          ...trustedEnv,
          DB: {
            ...baseDbForTests(),
            async revokeAgentAuthProviderIdentity() {
              return "replay_detected";
            },
          } as Partial<ApiDatabase> as ApiDatabase,
        },
      );
      expect(replay.status).toBe(400);
      await expect(replay.json()).resolves.toMatchObject({ err: "replay_detected" });

      const accepted = await handleRequest(
        new Request("https://api.test/agent/event/notify", {
          method: "POST",
          body: await fixture.sign("set_revoked", { typ: "secevent+jwt", payload: eventPayload }),
        }),
        {
          ...trustedEnv,
          DB: {
            ...baseDbForTests(),
            async revokeAgentAuthProviderIdentity() {
              return "revoked";
            },
          } as Partial<ApiDatabase> as ApiDatabase,
        },
      );
      expect(accepted.status).toBe(202);
    } finally {
      fixture.restore();
    }
  });

  it("handles browser completion for verified and anonymous agent claims", async () => {
    const authEnv: Pick<Env, "AUTH"> = { AUTH: webAuthForTests() };
    const missingAuth = await handleRequest(
      new Request("https://api.test/v1/web/agent-auth/claim/complete", { method: "POST" }),
      { DB: baseDbForTests() },
    );
    expect(missingAuth.status).toBe(401);
    await expect(missingAuth.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });

    const invalid = await handleRequest(
      new Request("https://api.test/v1/web/agent-auth/claim/complete", {
        method: "POST",
        headers: { authorization: "Bearer workos-ok", "content-type": "application/json" },
        body: JSON.stringify({ claim_token: "claim", user_code: "bad" }),
      }),
      { ...authEnv, DB: webMemberDbForTests(["read", "publish"]) },
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });

    const failed = await handleRequest(
      new Request("https://api.test/v1/web/agent-auth/claim/complete", {
        method: "POST",
        headers: { authorization: "Bearer workos-ok", "content-type": "application/json" },
        body: JSON.stringify({ claim_token: "claim", user_code: "123456" }),
      }),
      {
        ...authEnv,
        DB: webMemberDbForTests(["read", "publish"], {
          async completeAgentAuthClaim() {
            return null;
          },
        }),
      },
    );
    expect(failed.status).toBe(400);
    await expect(failed.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });

    const completed = await handleRequest(
      new Request("https://api.test/v1/web/agent-auth/claim/complete", {
        method: "POST",
        headers: { authorization: "Bearer workos-ok", "content-type": "application/json" },
        body: JSON.stringify({ claim_attempt_token: "attempt", user_code: "123456" }),
      }),
      {
        ...authEnv,
        DB: webMemberDbForTests(["read", "publish"], {
          async completeAgentAuthAnonymousClaim() {
            return agentRegistration("reg_completed", "anonymous");
          },
        }),
      },
    );
    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toEqual({ ok: true, registration_id: "reg_completed" });
  });

  it("serves a generated OpenAPI document", async () => {
    const response = await handleRequest(new Request("https://api.test/openapi.json"), {});
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.toLowerCase()).toContain("application/json");
    const doc = (await response.json()) as {
      info: { title: string };
      paths: Record<
        string,
        Record<string, { responses: Record<string, { description?: string; headers?: Record<string, unknown> }> }>
      >;
    };

    expect(doc.info.title).toBe("Agent Paste API");
    expect(doc.paths["/v1/whoami"]?.get.responses["429"]).toMatchObject({
      description: expect.stringContaining("Actor or workspace rate limit"),
      headers: expect.any(Object),
    });
    expect(doc.paths).not.toHaveProperty("/v1/web/admin/lockdowns");
    expect(doc.paths).not.toHaveProperty("/v1/web/admin/lockdowns/{scope}/{target_id}");
    expect(doc.paths).not.toHaveProperty("/v1/web/admin/events");
    expect(doc.paths).not.toHaveProperty("/v1/web/admin/workspaces/{workspace_id}/plan");
  });

  it("returns whoami for a valid api key", async () => {
    const env: Env = {
      AUTH: {
        async verifyApiKey(apiKey) {
          return apiKey === "ok" ? { type: "api_key", id: "key_1", workspace_id: "w_1" } : null;
        },
      },
      DB: {
        async getWhoami(actor) {
          return { actor };
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/whoami", { headers: { authorization: "Bearer ok" } }),
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ actor: { id: "key_1" } });
  });

  it("rejects cached API key actors after their expiry", async () => {
    const env: Env = {
      AUTH: {
        async verifyApiKey(apiKey) {
          return apiKey === "expired"
            ? { type: "api_key", id: "key_1", workspace_id: "w_1", expires_at: "2000-01-01T00:00:00.000Z" }
            : null;
        },
      },
      DB: {
        async getWhoami() {
          throw new Error("expired key should not reach db");
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/whoami", { headers: { authorization: "Bearer expired" } }),
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
  });

  it("rejects API key actors with malformed expiry", async () => {
    const env: Env = {
      AUTH: {
        async verifyApiKey(apiKey) {
          return apiKey === "bad-expiry"
            ? { type: "api_key", id: "key_1", workspace_id: "w_1", expires_at: "not-a-date" }
            : null;
        },
      },
      DB: {
        async getWhoami() {
          throw new Error("malformed key expiry should not reach db");
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/whoami", { headers: { authorization: "Bearer bad-expiry" } }),
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
  });

  it("revokes the current API key", async () => {
    const env: Env = {
      AUTH: {
        async verifyApiKey(apiKey) {
          return apiKey === "ok" ? { type: "api_key", id: "key_1", workspace_id: "w_1" } : null;
        },
      },
      DB: {
        async getWhoami() {
          throw new Error("self-revoke should not call whoami");
        },
        async revokeCurrentApiKey(input) {
          expect(input.actor).toMatchObject({ type: "api_key", id: "key_1", workspace_id: "w_1" });
          return {
            api_key: {
              id: input.actor.id,
              workspace_id: input.actor.workspace_id,
              name: "CLI",
              public_id: "01HZY7Q8X9Y2S3T4",
              scopes: ["publish", "read"],
              revoked_at: "2026-01-01T00:00:00.000Z",
              expires_at: "2026-04-01T00:00:00.000Z",
              created_at: "2026-01-01T00:00:00.000Z",
              last_used_at: null,
            },
            revoked_at: "2026-01-01T00:00:00.000Z",
          };
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/api-keys/current/revoke", {
        method: "POST",
        headers: { authorization: "Bearer ok" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      api_key: { id: "key_1", revoked_at: "2026-01-01T00:00:00.000Z" },
      revoked_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("returns 429 when the actor rate limit fires", async () => {
    const env: Env = {
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1" };
        },
      },
      DB: {
        async getWhoami() {
          throw new Error("rate limited requests should not reach db");
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async runCleanup() {
          return {};
        },
      },
      ACTOR_RATE_LIMIT: {
        async limit() {
          return { success: false };
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/whoami", { headers: { authorization: "Bearer ok" } }),
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "rate_limited_actor" } });
  });

  it("serves an authed member billing status through the full pipeline (regression: no fail-closed 429)", async () => {
    // The single env.DB binding plays both roles, exactly as a Hyperdrive binding does
    // in production: a Repository for member auth and a SqlExecutor for billing reads.
    const env: Env = {
      ...billingEnv(),
      AUTH: webAuthForTests(),
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async runCleanup() {
          return {};
        },
        async getWebMemberByWorkOsUserId() {
          return { type: "member", id: "mem_1", email: "user@example.com", workspace_id: "w_1", scopes: ["admin"] };
        },
        query: async () => ({ rows: [] }),
        transaction: async (run: (tx: unknown) => unknown) => run({ query: async () => ({ rows: [] }) }),
      } as never,
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/billing", { headers: { authorization: "Bearer workos-ok" } }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ plan: "free" });
  });

  it("rate-limits an authed member billing request when the actor limit trips", async () => {
    const env: Env = {
      ...billingEnv(),
      ACTOR_RATE_LIMIT: { limit: async () => ({ success: false }) },
      AUTH: webAuthForTests(),
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async runCleanup() {
          return {};
        },
        async getWebMemberByWorkOsUserId() {
          return { type: "member", id: "mem_1", email: "user@example.com", workspace_id: "w_1", scopes: ["admin"] };
        },
        query: async () => {
          throw new Error("rate-limited billing requests should not read the db");
        },
        transaction: async () => {
          throw new Error("rate-limited billing requests should not open a transaction");
        },
      } as never,
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/billing", { headers: { authorization: "Bearer workos-ok" } }),
      env,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "rate_limited_actor" } });
  });

  it.each([
    ["unset", {}, {}],
    ["unset", {}, { "Stripe-Signature": "t=1,v1=deadbeef" }],
    ["false", { BILLING_ENABLED: "false" }, {}],
    ["false", { BILLING_ENABLED: "false" }, { "Stripe-Signature": "t=1,v1=deadbeef" }],
  ] as const)("returns not_found before webhook auth or DB resolution when billing is %s", async (_label, billingFlag, headers) => {
    const response = await handleRequest(
      new Request("https://api.test/v1/billing/webhook", {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "evt_disabled_billing" }),
      }),
      {
        ...billingFlag,
        STRIPE_WEBHOOK_SIGNING_SECRET: "whsec_test",
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("requires read scope for authenticated Agent View", async () => {
    const env: Env = {
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["publish"] };
        },
      },
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          throw new Error("Agent View should not run without read scope");
        },
        async getPublicAgentView() {
          return null;
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/agent-view", {
        headers: { authorization: "Bearer ok" },
      }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it("provisions a WorkOS web member from the callback route", async () => {
    const env: Env = {
      AUTH: {
        async verifyApiKey() {
          return null;
        },
        async verifyWebToken(token) {
          return token === "workos-ok"
            ? { workos_user_id: "user_1", email: "user@example.com", token_id: "jti_1" }
            : null;
        },
      },
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async resolveWebMember(input) {
          expect(input.idempotencyKey).toBe("workos-jti:jti_1");
          return {
            workspace: {
              id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
              name: "User",
              created_at: "2026-01-01T00:00:00.000Z",
            },
            workspace_member: {
              id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
              workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
              email: input.email,
              scopes: ["publish", "read", "admin"],
              created_at: "2026-01-01T00:00:00.000Z",
              last_seen_at: input.now,
            },
            scopes: ["publish", "read", "admin"],
            default_api_key: null,
          };
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/auth/web/callback", {
        method: "POST",
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workspace_member: { email: "user@example.com" },
      default_api_key: null,
    });
  });

  it.each([
    ["missing", {}],
    ["blank", { token_id: "", session_id: "" }],
  ])("rejects %s callback identities without a WorkOS token or session id", async (_label, ids) => {
    const env: Env = {
      AUTH: {
        async verifyApiKey() {
          return null;
        },
        async verifyWebToken() {
          return { workos_user_id: "user_1", email: "user@example.com", ...ids } as never;
        },
      },
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async resolveWebMember() {
          throw new Error("callback should fail before member resolution");
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/auth/web/callback", {
        method: "POST",
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_authenticated", message: "missing WorkOS token_id or session_id" },
    });
  });

  it("calls resolveWebMember with the database receiver intact", async () => {
    const db = {
      marker: "receiver-kept",
      async getWhoami() {
        return {};
      },
      async getAgentView() {
        return null;
      },
      async getPublicAgentView() {
        return null;
      },
      async resolveWebMember(this: { marker: string }, input: { email: string; idempotencyKey: string }) {
        expect(input.idempotencyKey).toBe("workos-session:sess_1");
        return { receiver: this.marker, email: input.email };
      },
      async runCleanup() {
        return {};
      },
    };
    const env: Env = {
      AUTH: {
        async verifyApiKey() {
          return null;
        },
        async verifyWebToken() {
          return { workos_user_id: "user_1", email: "user@example.com", session_id: "sess_1" };
        },
      },
      DB: db as unknown as Env["DB"],
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/auth/web/callback", {
        method: "POST",
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ receiver: "receiver-kept", email: "user@example.com" });
  });

  it("rejects API keys on web dashboard routes", async () => {
    const env: Env = {
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["read"] };
        },
      },
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/workspace", { headers: { authorization: "Bearer ap_pk_preview_fake" } }),
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
  });

  it("rejects non-member actors returned by web member resolution", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async getWebMemberByWorkOsUserId() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["read"] };
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/workspace", { headers: { authorization: "Bearer workos-ok" } }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it("returns workspace context for a valid WorkOS member", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async getWebMemberByWorkOsUserId() {
          return {
            type: "member",
            id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
            workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
            scopes: ["read"],
          };
        },
        async getWebWorkspace(actor) {
          return {
            workspace: {
              id: actor.workspace_id,
              name: "User",
              created_at: "2026-01-01T00:00:00.000Z",
            },
            workspace_member: {
              id: actor.id,
              workspace_id: actor.workspace_id,
              email: "user@example.com",
              scopes: ["read"],
              created_at: "2026-01-01T00:00:00.000Z",
              last_seen_at: "2026-01-02T00:00:00.000Z",
            },
            usage_policy: {
              file_size_cap_bytes: 10 * 1024 * 1024,
              artifact_size_cap_bytes: 25 * 1024 * 1024,
              file_count_cap: 100,
              actor_rate_limit_per_minute: 60,
              workspace_burst_cap_per_minute: 300,
              upload_session_ttl_seconds: 24 * 60 * 60,
              default_ttl_seconds: 3 * 24 * 60 * 60,
              min_ttl_seconds: 24 * 60 * 60,
              max_ttl_seconds: 7 * 24 * 60 * 60,
              live_artifacts_cap: 50,
              live_update_enabled: false,
              daily_new_artifact_allowance: 100,
              lifetime_revision_ceiling: 100,
            },
            default_key_first_run: false,
          };
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/workspace", { headers: { authorization: "Bearer workos-ok" } }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workspace: { name: "User" },
      usage_policy: { file_count_cap: 100 },
      default_key_first_run: false,
    });
  });

  it("returns workspace-scoped dashboard artifacts for a valid WorkOS member", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async getWebMemberByWorkOsUserId() {
          return {
            type: "member",
            id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
            workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
            scopes: ["read"],
          };
        },
        async listWebArtifacts(actor, pagination) {
          expect(pagination).toEqual({ cursor: "next-page", limit: 2 });
          return {
            items: [
              {
                id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
                title: actor.workspace_id,
                status: "Published",
                latest_revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
                pinned: false,
                lockdown: false,
                last_published_at: "2026-01-01T00:00:00.000Z",
                auto_delete_at: "2026-02-01T00:00:00.000Z",
              },
            ],
            page_info: { next_cursor: null, has_more: false },
          };
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/artifacts?limit=2&cursor=next-page", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ title: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a" }],
    });
  });

  it("rejects invalid dashboard artifact pagination", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async getWebMemberByWorkOsUserId() {
          return {
            type: "member",
            id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
            workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
            scopes: ["read"],
          };
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/artifacts?limit=0", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });

  it("returns workspace-scoped dashboard audit events for a valid WorkOS member", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async getWebMemberByWorkOsUserId() {
          return {
            type: "member",
            id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
            workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
            scopes: ["admin"],
          };
        },
        async listWebAuditEvents(actor, pagination) {
          expect(pagination).toEqual({ cursor: "next-page", limit: 2 });
          return {
            items: [
              {
                id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
                time: "2026-01-01T00:00:00.000Z",
                actor: `member:${actor.id}`,
                action: "artifact.published",
                target: "artifact:art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
                change_summary: "file_count=1",
                request_id: "req_1",
              },
            ],
            page_info: { next_cursor: null, has_more: false },
          };
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/audit?limit=2&cursor=next-page", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ action: "artifact.published", actor: "member:mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ" }],
    });
  });

  it("rejects invalid dashboard audit pagination limits", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async getWebMemberByWorkOsUserId() {
          return {
            type: "member",
            id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
            workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
            scopes: ["admin"],
          };
        },
        async listWebAuditEvents() {
          throw new Error("audit pagination should fail before db lookup");
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/audit?limit=0", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });

  it("rejects invalid dashboard audit cursors", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async getWebMemberByWorkOsUserId() {
          return {
            type: "member",
            id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
            workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
            scopes: ["admin"],
          };
        },
        async listWebAuditEvents() {
          throw new Error("invalid_cursor");
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/audit?cursor=not-base64", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_cursor" } });
  });

  it("fails closed when a web member reads an artifact outside their workspace", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async getWebMemberByWorkOsUserId() {
          return {
            type: "member",
            id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
            workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
            scopes: ["read"],
          };
        },
        async getWebArtifact() {
          return null;
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("signs web artifact viewer URLs with sibling file access", async () => {
    const { verifyContentToken } = await import("@agent-paste/tokens/content");
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const env: Env = {
      AUTH: webAuthForTests(),
      CONTENT_BASE_URL: "https://content.test",
      CONTENT_SIGNING_SECRET: "content-secret",
      DB: webMemberDbForTests(["read"], {
        async getWebArtifact() {
          return {
            id: artifactId,
            title: "Demo",
            status: "Published",
            latest_revision_id: revisionId,
            pinned: false,
            lockdown: false,
            last_published_at: "2026-01-01T00:00:00.000Z",
            auto_delete_at: null,
            entrypoint: "index.html",
            file_count: 2,
            size_bytes: 42,
            viewer: {
              iframe_src: `https://content.test/v/${artifactId}.${revisionId}/index.html`,
              render_mode: "html",
            },
          };
        },
        async getAgentView(input) {
          expect(input).toMatchObject({
            artifactId,
            contentBaseUrl: "https://content.test",
            actor: { type: "member" },
          });
          return {
            ...agentViewFixture(artifactId, revisionId),
            workspace_id: input.actor.workspace_id,
            revision_content_url: `https://content.test/v/${artifactId}.${revisionId}/index.html`,
            files: [
              {
                path: "index.html",
                url: `https://content.test/v/${artifactId}.${revisionId}/index.html`,
                content_type: "text/html",
                size_bytes: 12,
              },
              {
                path: "test-image.png",
                url: `https://content.test/v/${artifactId}.${revisionId}/test-image.png`,
                content_type: "image/png",
                size_bytes: 30,
              },
            ],
          };
        },
      }),
    };

    const response = await handleRequest(
      new Request(`https://api.test/v1/web/artifacts/${artifactId}`, {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { viewer?: { iframe_src?: string } };
    const iframeSrc = body.viewer?.iframe_src;
    expect(iframeSrc).toEqual(expect.stringContaining("https://content.test/v/"));
    const token = new URL(iframeSrc ?? "").pathname.split("/")[2] ?? "";
    const payload = await verifyContentToken(token, "content-secret");
    expect(payload).toMatchObject({
      artifact_id: artifactId,
      revision_id: revisionId,
      paths: ["index.html", "test-image.png"],
    });
  });

  it("signs the dashboard viewer token with the artifact expiry", async () => {
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const expiresAt = "2030-01-01T00:00:00.000Z";
    const env: Env = {
      AUTH: webAuthForTests(),
      CONTENT_SIGNING_SECRET: "content-secret",
      CONTENT_BASE_URL: "https://content.test",
      DB: webMemberDbForTests(["read"], {
        async getWebArtifact() {
          return {
            id: artifactId,
            title: "Detail",
            status: "Published",
            latest_revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
            pinned: false,
            lockdown: false,
            last_published_at: "2026-01-01T00:00:00.000Z",
            auto_delete_at: expiresAt,
            entrypoint: "index.html",
            file_count: 1,
            size_bytes: 12,
            viewer: { iframe_src: "https://content.test/v/old/index.html", render_mode: "html" },
          };
        },
      }),
    };

    const response = await handleRequest(
      new Request(`https://api.test/v1/web/artifacts/${artifactId}`, {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { viewer: { iframe_src: string } };
    const token = decodeURIComponent(body.viewer.iframe_src.split("/v/")[1]?.split("/")[0] ?? "");
    const { verifyContentToken } = await import("@agent-paste/tokens/content");
    const payload = await verifyContentToken(token, "content-secret");
    expect(payload?.exp).toBe(Math.floor(new Date(expiresAt).getTime() / 1000));
  });

  it("maps pinned_artifact_cap_exceeded to a 409 contract error on pin", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["read"], {
        async pinWebArtifact() {
          throw new Error("pinned_artifact_cap_exceeded");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/pin", {
        method: "POST",
        headers: {
          authorization: "Bearer workos-ok",
          "idempotency-key": "idem-pin-cap",
        },
      }),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "pinned_artifact_cap_exceeded" },
    });
  });

  it.each([
    ["create", "https://api.test/v1/web/keys", { method: "POST", body: JSON.stringify({ name: "cli" }) }],
    ["revoke", "https://api.test/v1/web/keys/key_1/revoke", { method: "POST" }],
  ])("rejects API keys on web key %s routes", async (_label, url, init) => {
    const env: Env = {
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["read"] };
        },
      },
      DB: baseDbForTests(),
    };

    const response = await handleRequest(
      new Request(url, {
        ...init,
        headers: {
          authorization: "Bearer ap_pk_preview_fake",
          "content-type": "application/json",
          "idempotency-key": "idem-1",
        },
      }),
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
  });

  it("rejects web key creation for members without admin scope", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["read"], {
        async createWebApiKey() {
          throw new Error("create should not run without admin scope");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/keys", {
        method: "POST",
        headers: {
          authorization: "Bearer workos-ok",
          "content-type": "application/json",
          "idempotency-key": "idem-create",
        },
        body: JSON.stringify({ name: "CLI" }),
      }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it.each([
    ["create", "https://api.test/v1/web/keys", { method: "POST", body: JSON.stringify({ name: "CLI" }) }],
    ["revoke", "https://api.test/v1/web/keys/key_1/revoke", { method: "POST" }],
  ])("requires idempotency keys for web key %s", async (_label, url, init) => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["admin"], {
        async createWebApiKey() {
          throw new Error("create should not run without idempotency");
        },
        async revokeWebApiKey() {
          throw new Error("revoke should not run without idempotency");
        },
      }),
    };

    const response = await handleRequest(
      new Request(url, {
        ...init,
        headers: { authorization: "Bearer workos-ok", "content-type": "application/json" },
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_idempotency_key" } });
  });

  it.each(["", " ".repeat(3), "x".repeat(121)])("rejects invalid web key name %#", async (name) => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["admin"], {
        async createWebApiKey() {
          throw new Error("create should not run for invalid names");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/keys", {
        method: "POST",
        headers: {
          authorization: "Bearer workos-ok",
          "content-type": "application/json",
          "idempotency-key": "idem-invalid",
        },
        body: JSON.stringify({ name }),
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });

  it("rejects malformed JSON for web key creation", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["admin"], {
        async createWebApiKey() {
          throw new Error("create should not run for malformed JSON");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/keys", {
        method: "POST",
        headers: {
          authorization: "Bearer workos-ok",
          "content-type": "application/json",
          "idempotency-key": "idem-invalid-json",
        },
        body: "{",
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });

  it("creates a web API key from the member workspace", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["admin"], {
        async createWebApiKey(input) {
          expect(input.actor).toMatchObject({
            type: "member",
            id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
            workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
          });
          expect(input.idempotencyKey).toBe("idem-create");
          expect(input.name).toBe("CLI Key");
          expect(input.expiresInSeconds).toBeUndefined();
          return {
            api_key: {
              id: "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
              workspace_id: input.actor.workspace_id,
              name: input.name,
              public_id: "01HZY7Q8X9Y2S3T4",
              scopes: ["publish", "read"],
              revoked_at: null,
              expires_at: null,
              created_at: "2026-01-01T00:00:00.000Z",
              last_used_at: null,
            },
            secret: "ap_pk_preview_01HZY7Q8X9Y2S3T4_secretsecretsecretsecretsecret",
          };
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/keys", {
        method: "POST",
        headers: {
          authorization: "Bearer workos-ok",
          "content-type": "application/json",
          "idempotency-key": "idem-create",
        },
        body: JSON.stringify({ name: "  CLI Key  " }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      api_key: { name: "CLI Key", scopes: ["publish", "read"] },
      secret: expect.stringMatching(/^ap_pk_preview_/),
    });
  });

  it("provisions a brand-new member on the key-mint route when none exists yet", async () => {
    let ensureCalls = 0;
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: {
        ...baseDbForTests(),
        async getWebMemberByWorkOsUserId() {
          return null;
        },
        async ensureWebMember(input: { workosUserId: string; email: string }) {
          ensureCalls += 1;
          expect(input).toMatchObject({ workosUserId: "user_1", email: "user@example.com" });
          return {
            type: "member",
            id: "mem_provisioned",
            workspace_id: "ws_provisioned",
            email: "user@example.com",
            scopes: ["publish", "read", "admin"],
          };
        },
        async createWebApiKey(input) {
          expect(input.actor).toMatchObject({ type: "member", id: "mem_provisioned", workspace_id: "ws_provisioned" });
          return {
            api_key: {
              id: "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
              workspace_id: input.actor.workspace_id,
              name: input.name,
              public_id: "01HZY7Q8X9Y2S3T4",
              scopes: ["publish", "read"],
              revoked_at: null,
              expires_at: null,
              created_at: "2026-01-01T00:00:00.000Z",
              last_used_at: null,
            },
            secret: "ap_pk_preview_01HZY7Q8X9Y2S3T4_secretsecretsecretsecretsecret",
          };
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/keys", {
        method: "POST",
        headers: {
          authorization: "Bearer workos-ok",
          "content-type": "application/json",
          "idempotency-key": "idem-jit",
        },
        body: JSON.stringify({ name: "agent-paste CLI" }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    expect(ensureCalls).toBe(1);
  });

  it("sets a 90 day expiry when the key-mint route is called with a CLI WorkOS token", async () => {
    const env: Env = {
      AUTH: {
        async verifyApiKey() {
          return null;
        },
        async verifyWebToken() {
          return { workos_user_id: "user_1", email: "user@example.com", token_id: "jti_1", auth_surface: "cli" };
        },
      },
      DB: webMemberDbForTests(["admin"], {
        async createWebApiKey(input) {
          expect(input.expiresInSeconds).toBe(7_776_000);
          return {
            api_key: {
              id: "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
              workspace_id: input.actor.workspace_id,
              name: input.name,
              public_id: "01HZY7Q8X9Y2S3T4",
              scopes: ["publish", "read"],
              revoked_at: null,
              expires_at: "2026-04-01T00:00:00.000Z",
              created_at: "2026-01-01T00:00:00.000Z",
              last_used_at: null,
            },
            secret: "ap_pk_preview_01HZY7Q8X9Y2S3T4_secretsecretsecretsecretsecret",
          };
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/keys", {
        method: "POST",
        headers: {
          authorization: "Bearer workos-ok",
          "content-type": "application/json",
          "idempotency-key": "idem-cli",
        },
        body: JSON.stringify({ name: "agent-paste CLI" }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ api_key: { expires_at: "2026-04-01T00:00:00.000Z" } });
  });

  it("revokes a web API key from the member workspace", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["admin"], {
        async revokeWebApiKey(input) {
          expect(input).toMatchObject({
            actor: { type: "member", id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ" },
            idempotencyKey: "idem-revoke",
            apiKeyId: "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          });
          return {
            api_key: {
              id: input.apiKeyId,
              workspace_id: input.actor.workspace_id,
              name: "CLI Key",
              public_id: "01HZY7Q8X9Y2S3T4",
              scopes: ["publish", "read"],
              revoked_at: "2026-01-01T00:00:00.000Z",
              expires_at: null,
              created_at: "2026-01-01T00:00:00.000Z",
              last_used_at: null,
            },
            revoked_at: "2026-01-01T00:00:00.000Z",
          };
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/keys/key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/revoke", {
        method: "POST",
        headers: { authorization: "Bearer workos-ok", "idempotency-key": "idem-revoke" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      api_key: { revoked_at: "2026-01-01T00:00:00.000Z" },
      revoked_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("returns generic not_found for missing web API key revocation targets", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["admin"], {
        async revokeWebApiKey() {
          const { RepositoryError } = await import("@agent-paste/db");
          throw new RepositoryError("not_found");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/keys/key_missing/revoke", {
        method: "POST",
        headers: { authorization: "Bearer workos-ok", "idempotency-key": "idem-revoke" },
      }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("updates web settings from the member workspace", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["admin"], {
        async updateWebSettings(input) {
          expect(input).toMatchObject({
            actor: { type: "member", id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ" },
            idempotencyKey: "idem-settings",
            workspaceName: "Renamed Workspace",
            autoDeletionDays: 7,
          });
          return {
            workspace_name: input.workspaceName,
            auto_deletion_days: input.autoDeletionDays,
            auto_deletion_bounds: { min_days: 1, max_days: 7 },
            usage_policy: { artifacts_per_day: 0, bytes_per_day: 26_214_400 },
          };
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/settings", {
        method: "PATCH",
        headers: {
          authorization: "Bearer workos-ok",
          "content-type": "application/json",
          "idempotency-key": "idem-settings",
        },
        body: JSON.stringify({ workspace_name: "Renamed Workspace", auto_deletion_days: 7 }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workspace_name: "Renamed Workspace",
      auto_deletion_days: 7,
    });
  });

  it.each([
    ["below the minimum", { workspace_name: "ok", auto_deletion_days: 0 }],
    ["above the maximum", { workspace_name: "ok", auto_deletion_days: 91 }],
    ["a non-integer", { workspace_name: "ok", auto_deletion_days: 1.5 }],
    ["a blank name", { workspace_name: "", auto_deletion_days: 7 }],
    ["a too-long name", { workspace_name: "x".repeat(121), auto_deletion_days: 7 }],
  ])("rejects web settings updates with %s", async (_label, body) => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["admin"], {
        async updateWebSettings() {
          throw new Error("update should not run for invalid bodies");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/settings", {
        method: "PATCH",
        headers: {
          authorization: "Bearer workos-ok",
          "content-type": "application/json",
          "idempotency-key": "idem-settings-invalid",
        },
        body: JSON.stringify(body),
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });

  it("requires an idempotency key for web settings updates", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["admin"], {
        async updateWebSettings() {
          throw new Error("update should not run without idempotency");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/settings", {
        method: "PATCH",
        headers: { authorization: "Bearer workos-ok", "content-type": "application/json" },
        body: JSON.stringify({ workspace_name: "ok", auto_deletion_days: 7 }),
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_idempotency_key" } });
  });

  it("rejects web settings updates for members without admin scope", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["read"], {
        async updateWebSettings() {
          throw new Error("update should not run without admin scope");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/settings", {
        method: "PATCH",
        headers: {
          authorization: "Bearer workos-ok",
          "content-type": "application/json",
          "idempotency-key": "idem-settings-scope",
        },
        body: JSON.stringify({ workspace_name: "ok", auto_deletion_days: 7 }),
      }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it("fails closed when a rate limit binding errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env: Env = {
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1" };
        },
      },
      DB: {
        async getWhoami(actor) {
          return { actor };
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async runCleanup() {
          return {};
        },
      },
      ACTOR_RATE_LIMIT: {
        async limit() {
          throw new Error("binding unavailable");
        },
      },
    };

    try {
      const response = await handleRequest(
        new Request("https://api.test/v1/whoami", { headers: { authorization: "Bearer ok" } }),
        env,
      );

      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "rate_limited_actor" } });
      expect(warn).toHaveBeenCalledWith("Rate limit actor binding failed; denying request.", expect.any(Error));
    } finally {
      warn.mockRestore();
    }
  });

  it("returns public Agent View not_found before enforcing artifact rate limits", async () => {
    const limit = vi.fn(async () => {
      throw new Error("binding unavailable");
    });
    const getPublicAgentView = vi.fn(async () => null);
    const env: Env = {
      AGENT_VIEW_SIGNING_SECRET: "test-secret",
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        getPublicAgentView,
        async runCleanup() {
          return {};
        },
      },
      ARTIFACT_RATE_LIMIT: { limit },
    };

    const token = await mintAgentViewToken(
      { artifact_id: "art_1", revision_id: "rev_1", exp: Math.floor(Date.now() / 1000) + 3600 },
      "test-secret",
    );
    const response = await handleRequest(new Request(`https://api.test/v1/public/agent-view/${token}`), env);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
    expect(getPublicAgentView).toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when a resolved public Agent View exceeds the artifact limit", async () => {
    const env: Env = {
      AGENT_VIEW_SIGNING_SECRET: "test-secret",
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return {
            artifact_id: "art_1",
            revision_id: "rev_1",
            title: "Public",
            entrypoint: "index.html",
            files: [],
            bundle: { status: "pending" },
          };
        },
        async runCleanup() {
          return {};
        },
      },
      ARTIFACT_RATE_LIMIT: {
        async limit() {
          return { success: false };
        },
      },
    };

    const token = await mintAgentViewToken(
      { artifact_id: "art_1", revision_id: "rev_1", exp: Math.floor(Date.now() / 1000) + 3600 },
      "test-secret",
    );
    const response = await handleRequest(new Request(`https://api.test/v1/public/agent-view/${token}`), env);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "rate_limited_artifact" } });
  });

  it("writes the ADR 0057 artifact denylist key when the smoke harness deletes an artifact", async () => {
    const puts: Array<{ key: string; value: string; expirationTtl?: number }> = [];
    const env: Env = {
      AGENT_PASTE_ENV: "preview",
      SMOKE_HARNESS_SECRET: "harness",
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async getArtifactDetail() {
          return {
            id: "art_1",
            workspace_id: "ws_1",
            revision_id: "rev_1",
            status: "active",
          };
        },
        async deleteArtifact() {
          return {
            artifact_id: "art_1",
            workspace_id: "ws_1",
            revision_id: "rev_1",
            deleted_at: "2026-01-01T00:00:00.000Z",
          };
        },
        async runCleanup() {
          return {};
        },
      },
      DENYLIST: {
        async put(key, value, options) {
          puts.push({ key, value, expirationTtl: options?.expirationTtl });
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/__test__/delete-artifact", {
        method: "POST",
        headers: { authorization: "Bearer harness", "content-type": "application/json" },
        body: JSON.stringify({ artifact_id: "art_1" }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ artifact_id: "art_1", deleted_r2_objects: 0 });
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ key: "ad:art_1", expirationTtl: 7 * 24 * 60 * 60 });
    expect(JSON.parse(puts[0]?.value ?? "{}")).toMatchObject({ reason: "deletion", at: expect.any(String) });
  });

  it("rejects malformed JSON in smoke harness helpers", async () => {
    const env: Env = {
      AGENT_PASTE_ENV: "preview",
      SMOKE_HARNESS_SECRET: "harness",
      DB: operatorDbForTests({
        async forceExpireArtifact() {
          throw new Error("force expire should not run for malformed JSON");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/__test__/force-expire", {
        method: "POST",
        headers: { authorization: "Bearer harness", "content-type": "application/json" },
        body: "{",
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });

  it("renders public Agent View as HTML for browsers", async () => {
    const env: Env = {
      AGENT_VIEW_SIGNING_SECRET: "test-secret",
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return {
            artifact_id: "art_1",
            revision_id: "rev_1",
            title: "Browser Proof",
            ephemeral_tier: true,
            revision_content_url: "https://content.test/v/token/index.html",
            files: [
              {
                path: "index.html",
                url: "https://content.test/v/token/index.html",
                content_type: "text/html",
                size_bytes: 12,
              },
            ],
          };
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const token = await mintAgentViewToken(
      { artifact_id: "art_1", revision_id: "rev_1", exp: Math.floor(Date.now() / 1000) + 3600 },
      "test-secret",
    );
    const response = await handleRequest(
      new Request(`https://api.test/v1/public/agent-view/${token}`, { headers: { accept: "text/html" } }),
      env,
    );

    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const html = await response.text();
    expect(html).toContain("Browser Proof");
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
  });

  it("rejects unsigned public Agent View tokens", async () => {
    const env: Env = {
      AGENT_VIEW_SIGNING_SECRET: "test-secret",
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          throw new Error("unsigned token should be rejected before db lookup");
        },
        async runCleanup() {
          return {};
        },
      },
    };

    const response = await handleRequest(new Request("https://api.test/v1/public/agent-view/art_1.rev_1"), env);

    expect(response.status).toBe(404);
  });

  it("resolves access links and collapses invalid cases to not_found", async () => {
    const resolveCalls: Array<{ publicId: string; blobScopes: number }> = [];
    const env: Env = {
      ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret",
      CONTENT_SIGNING_SECRET: "content-secret",
      CONTENT_BASE_URL: "https://content.test",
      DB: {
        async getWhoami() {
          return {};
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async resolveAccessLink(input) {
          resolveCalls.push({ publicId: input.publicId, blobScopes: input.blobScopes });
          return {
            access_link_id: "al_test",
            access_link_type: "share",
            workspace_id: "00000000-0000-4000-8000-000000000001",
            render_mode: "html",
            title: "Shared",
            iframe_src: "https://content.test/v/art_1.rev_1/index.html",
            agent_view: {
              artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
              revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
              title: "Shared",
              created_at: "2026-01-01T00:00:00.000Z",
              expires_at: "2030-01-01T00:00:00.000Z",
              entrypoint: "index.html",
              revision_content_url: "https://content.test/v/art_1.rev_1/index.html",
              files: [
                {
                  path: "index.html",
                  size_bytes: 12,
                  content_type: "text/html",
                  url: "https://content.test/v/art_1.rev_1/index.html",
                },
              ],
            },
          };
        },
        async runCleanup() {
          return {};
        },
      },
    };
    const blob = await mintAccessLinkBlob({
      publicId: "0123456789ABCDEF",
      kid: 1,
      exp: Date.now() + 60_000,
      scopes: 7,
      signingSecret: "access-link-secret",
    });
    const ok = await handleRequest(
      new Request("https://api.test/v1/access-links/resolve", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ public_id: "0123456789ABCDEF", blob }),
      }),
      env,
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({
      render_mode: "html",
      title: "Shared",
      agent_view: { artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" },
    });
    expect(resolveCalls).toEqual([{ publicId: "0123456789ABCDEF", blobScopes: 7 }]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const throwingRateLimit = await handleRequest(
        new Request("https://api.test/v1/access-links/resolve", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ public_id: "0123456789ABCDEF", blob }),
        }),
        {
          ...env,
          ARTIFACT_RATE_LIMIT: {
            async limit() {
              throw new Error("binding unavailable");
            },
          },
        },
      );
      expect(throwingRateLimit.status).toBe(429);
      expect(throwingRateLimit.headers.get("retry-after")).toBe("60");
      await expect(throwingRateLimit.json()).resolves.toMatchObject({
        error: { code: "rate_limited_artifact" },
      });
      expect(warn).toHaveBeenCalledWith(
        "Artifact rate limit binding failed; denying access link resolve.",
        expect.any(Error),
      );
    } finally {
      warn.mockRestore();
    }

    const missingRateLimit = await handleRequest(
      new Request("https://api.test/v1/access-links/resolve", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ public_id: "0123456789ABCDEF", blob }),
      }),
      { ...env, ARTIFACT_RATE_LIMIT: undefined },
    );
    expect(missingRateLimit.status).toBe(429);
    expect(missingRateLimit.headers.get("retry-after")).toBe("60");
    await expect(missingRateLimit.json()).resolves.toMatchObject({
      error: { code: "rate_limited_artifact" },
    });

    const missingSigningKey = await handleRequest(
      new Request("https://api.test/v1/access-links/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ public_id: "0123456789ABCDEF", blob }),
      }),
      { DB: env.DB },
    );
    expect(missingSigningKey.status).toBe(404);

    const badBlob = await handleRequest(
      new Request("https://api.test/v1/access-links/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ public_id: "0123456789ABCDEF", blob: "bad" }),
      }),
      env,
    );
    expect(badBlob.status).toBe(404);
  });

  it("sets a lockdown for a WorkOS operator and writes the denylist key", async () => {
    const puts: Array<{ key: string; value: string; expirationTtl?: number }> = [];
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async setLockdown(input) {
          expect(input).toMatchObject({
            actor: { type: "platform", id: "user@example.com" },
            idempotencyKey: "lock-1",
            scope: "workspace",
            targetId: "w_123",
            reasonCode: "abuse",
          });
          return lockdownDetail({ scope: "workspace", target_id: "w_123", reason_code: "abuse" });
        },
      }),
      DENYLIST: {
        async put(key, value, options) {
          puts.push({ key, value, expirationTtl: options?.expirationTtl });
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/lockdowns", {
        method: "POST",
        headers: {
          authorization: "Bearer workos-ok",
          "content-type": "application/json",
          "idempotency-key": "lock-1",
        },
        body: JSON.stringify({ scope: "workspace", target_id: "w_123", reason_code: "abuse" }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ scope: "workspace", target_id: "w_123" });
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ key: "wsd:w_123" });
    expect(puts[0]?.expirationTtl).toEqual(expect.any(Number));
    expect(JSON.parse(puts[0]?.value ?? "{}")).toMatchObject({
      reason: "platform_lockdown_workspace",
      at: expect.any(String),
    });
  });

  it("lifts a lockdown and deletes the denylist key", async () => {
    const deletes: string[] = [];
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async liftLockdown(input) {
          expect(input).toMatchObject({
            scope: "artifact",
            targetId: "art_9",
            idempotencyKey: "lift-1",
            actor: { type: "platform", id: "user@example.com" },
          });
          return lockdownDetail({
            scope: "artifact",
            target_id: "art_9",
            lifted_at: "2026-01-02T00:00:00.000Z",
            lifted_by: "user@example.com",
          });
        },
      }),
      DENYLIST: {
        async put() {},
        async delete(key) {
          deletes.push(key);
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/lockdowns/artifact/art_9", {
        method: "DELETE",
        headers: { authorization: "Bearer workos-ok", "idempotency-key": "lift-1" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      scope: "artifact",
      target_id: "art_9",
      lifted_by: "user@example.com",
    });
    expect(deletes).toEqual(["ad:art_9"]);
  });

  it("returns 404 when lifting a lockdown that does not exist", async () => {
    const deletes: string[] = [];
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async liftLockdown() {
          throw new Error("not_found");
        },
      }),
      DENYLIST: {
        async put() {},
        async delete(key) {
          deletes.push(key);
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/lockdowns/workspace/missing", {
        method: "DELETE",
        headers: { authorization: "Bearer workos-ok", "idempotency-key": "lift-missing" },
      }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
    expect(deletes).toEqual([]);
  });

  it("returns 404 when lifting a lockdown with an unsupported scope", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async liftLockdown() {
          throw new Error("liftLockdown must not run for an invalid scope");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/lockdowns/tenant/t_1", {
        method: "DELETE",
        headers: { authorization: "Bearer workos-ok", "idempotency-key": "lift-badscope" },
      }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("returns 404 for a WorkOS session without the admin role", async () => {
    const env: Env = {
      AUTH: webAuthForTests("member"),
      DB: operatorDbForTests({
        async setLockdown() {
          throw new Error("setLockdown must not run for non-admin roles");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/lockdowns", {
        method: "POST",
        headers: {
          authorization: "Bearer workos-ok",
          "content-type": "application/json",
          "idempotency-key": "lock-deny",
        },
        body: JSON.stringify({ scope: "workspace", target_id: "w_123", reason_code: "abuse" }),
      }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("returns 404 for an API-key bearer on operator routes", async () => {
    const env: Env = {
      AUTH: {
        async verifyApiKey(apiKey) {
          return apiKey === "ap_pk_live_example" ? { type: "api_key", id: "key_1", workspace_id: "w_1" } : null;
        },
        async verifyWebToken() {
          return null;
        },
      },
      DB: operatorDbForTests({
        async setLockdown() {
          throw new Error("setLockdown must not run for api keys");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/lockdowns", {
        method: "POST",
        headers: {
          authorization: "Bearer ap_pk_live_example",
          "content-type": "application/json",
          "idempotency-key": "lock-apikey",
        },
        body: JSON.stringify({ scope: "workspace", target_id: "w_123", reason_code: "abuse" }),
      }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("returns 404 when no authentication is provided to operator routes", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async setLockdown() {
          throw new Error("setLockdown must not run without auth");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/lockdowns", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "lock-noauth" },
        body: JSON.stringify({ scope: "workspace", target_id: "w_123", reason_code: "abuse" }),
      }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("lists effective lockdowns for a WorkOS operator", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async listLockdowns(actor, pagination) {
          expect(actor).toMatchObject({ type: "platform", id: "user@example.com" });
          expect(pagination).toEqual({ limit: 50 });
          return {
            items: [
              lockdownDetail({ scope: "workspace", target_id: "w_1" }),
              lockdownDetail({ scope: "artifact", target_id: "art_2" }),
            ],
            page_info: { next_cursor: null, has_more: false },
          };
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/lockdowns", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        { scope: "workspace", target_id: "w_1" },
        { scope: "artifact", target_id: "art_2" },
      ],
      page_info: { next_cursor: null, has_more: false },
    });
  });

  it("lists operator audit events with filters for a WorkOS operator", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async listOperatorEvents(actor, input) {
          expect(actor).toMatchObject({ type: "platform", id: "user@example.com" });
          expect(input).toEqual({
            limit: 25,
            focus: "security",
            actorType: "platform",
            requestId: "req_1",
          });
          return {
            items: [
              {
                id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
                time: "2026-01-01T00:00:00.000Z",
                actor: "platform:user@example.com",
                actor_type: "platform",
                action: "platform.lockdown.set",
                target: "workspace:w_1",
                target_type: "workspace",
                workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
                change_summary: "Platform lockdown set on workspace (reason: abuse)",
                request_id: "req_1",
              },
            ],
            page_info: { next_cursor: null, has_more: false },
          };
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/events?limit=25&focus=security&actor_type=platform&request_id=req_1", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ action: "platform.lockdown.set", actor_type: "platform" }],
    });
  });

  it("rejects invalid operator event filters", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async listOperatorEvents() {
          throw new Error("listOperatorEvents must not run for invalid filters");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/events?focus=unknown", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });

  it("paginates effective lockdowns and excludes lifted ones via the repository", async () => {
    const lockdowns = [
      lockdownDetail({ scope: "workspace", target_id: "w_3", set_at: "2026-01-03T00:00:00.000Z" }),
      lockdownDetail({ scope: "workspace", target_id: "w_2", set_at: "2026-01-02T00:00:00.000Z" }),
    ];
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async listLockdowns(_actor, pagination) {
          expect(pagination).toEqual({ limit: 1 });
          return { items: [lockdowns[0]], page_info: { next_cursor: "cursor-2", has_more: true } };
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/lockdowns?limit=1", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [lockdowns[0]],
      page_info: { next_cursor: "cursor-2", has_more: true },
    });
  });

  it("returns invalid_cursor when listing lockdowns with a bad cursor", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async listLockdowns(_actor, pagination) {
          expect(pagination).toEqual({ limit: 50, cursor: "not-base64" });
          throw new Error("invalid_cursor");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/lockdowns?cursor=not-base64", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_cursor" } });
  });

  it("rejects invalid lockdown pagination limits for an operator", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async listLockdowns() {
          throw new Error("listLockdowns must not run for an invalid limit");
        },
      }),
    };

    for (const limit of ["0", "101"]) {
      const response = await handleRequest(
        new Request(`https://api.test/v1/web/admin/lockdowns?limit=${limit}`, {
          headers: { authorization: "Bearer workos-ok" },
        }),
        env,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
    }
  });

  it("returns 404 listing lockdowns for a WorkOS session without the admin role", async () => {
    const env: Env = {
      AUTH: webAuthForTests("member"),
      DB: operatorDbForTests({
        async listLockdowns() {
          throw new Error("listLockdowns must not run for non-admin roles");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/lockdowns", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("returns 404 listing lockdowns for an API-key bearer", async () => {
    const env: Env = {
      AUTH: {
        async verifyApiKey(apiKey) {
          return apiKey === "ap_pk_live_example" ? { type: "api_key", id: "key_1", workspace_id: "w_1" } : null;
        },
        async verifyWebToken() {
          return null;
        },
      },
      DB: operatorDbForTests({
        async listLockdowns() {
          throw new Error("listLockdowns must not run for api keys");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/lockdowns", {
        headers: { authorization: "Bearer ap_pk_live_example" },
      }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("returns 404 listing lockdowns when no authentication is provided", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async listLockdowns() {
          throw new Error("listLockdowns must not run without auth");
        },
      }),
    };

    const response = await handleRequest(new Request("https://api.test/v1/web/admin/lockdowns"), env);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("returns 404 listing lockdowns for an invalid Cloudflare Access JWT", async () => {
    const env: Env = {
      CF_ACCESS_TEAM_DOMAIN: "ops.cloudflareaccess.com",
      CF_ACCESS_AUD: "aud-tag",
      AUTH: {
        async verifyApiKey() {
          return null;
        },
        async verifyWebToken() {
          return null;
        },
      },
      DB: operatorDbForTests({
        async listLockdowns() {
          throw new Error("listLockdowns must not run for an invalid Access JWT");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/admin/lockdowns", {
        headers: { "Cf-Access-Jwt-Assertion": "not-a-valid-jwt" },
      }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("serves usage policy for authenticated callers", async () => {
    const response = await handleRequest(
      new Request("https://api.test/v1/usage-policy", { headers: { authorization: "Bearer ok" } }),
      {
        AUTH: {
          async verifyApiKey() {
            return { type: "api_key", id: "key_1", workspace_id: "w_1" };
          },
        },
        DB: operatorDbForTests({
          async getUsagePolicy() {
            return {
              file_size_cap_bytes: 25 * 1024 * 1024,
              artifact_size_cap_bytes: 100 * 1024 * 1024,
              bundle_size_cap_bytes: 100 * 1024 * 1024,
              bundles_enabled: true,
              file_count_cap: 100,
              actor_rate_limit_per_minute: 60,
              workspace_burst_cap_per_minute: 300,
              upload_session_ttl_seconds: 86_400,
              default_ttl_seconds: 30 * 24 * 60 * 60,
              min_ttl_seconds: 24 * 60 * 60,
              max_ttl_seconds: 90 * 24 * 60 * 60,
              live_artifacts_cap: 1_000,
              live_update_enabled: true,
            };
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      file_count_cap: 100,
      actor_rate_limit_per_minute: 60,
      workspace_burst_cap_per_minute: 300,
      live_artifacts_cap: 1_000,
    });
  });

  it("lists and publishes revisions for authenticated API keys", async () => {
    const publishCalls: unknown[] = [];
    const env: Env = {
      CONTENT_SIGNING_SECRET: "content-secret",
      CONTENT_BASE_URL: "https://content.test",
      API_BASE_URL: "https://api.test",
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["publish", "read"] };
        },
      },
      DB: operatorDbForTests({
        async listRevisions() {
          return {
            artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
            items: [
              {
                revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
                revision_number: 1,
                status: "published",
                entrypoint: "index.html",
                render_mode: "html",
                file_count: 1,
                size_bytes: 12,
                created_at: "2026-01-01T00:00:00.000Z",
                published_at: "2026-01-01T00:00:00.000Z",
              },
            ],
            page_info: { next_cursor: null, has_more: false },
          };
        },
        async publishRevision(input) {
          publishCalls.push(input);
          return {
            artifact_id: input.artifactId,
            revision_id: input.revisionId,
            title: "Demo",
            revision_content_url: "https://content.test/v/art.rev/index.html",
            agent_view_url: "https://api.test/v1/public/agent-view/art.rev",
            expires_at: "2026-02-01T00:00:00.000Z",
          };
        },
      }),
    };

    const listResponse = await handleRequest(
      new Request("https://api.test/v1/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/revisions", {
        headers: { authorization: "Bearer ok" },
      }),
      env,
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      items: [{ revision_number: 1 }],
    });

    const publishResponse = await handleRequest(
      new Request(
        "https://api.test/v1/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/revisions/rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/publish",
        { method: "POST", headers: { authorization: "Bearer ok", "idempotency-key": "idem-rev" } },
      ),
      env,
    );
    expect(publishResponse.status).toBe(200);
    await expect(publishResponse.json()).resolves.toMatchObject({
      artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    });
    expect(publishCalls).toEqual([
      expect.objectContaining({
        artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        idempotencyKey: "idem-rev",
      }),
    ]);

    const missingResponse = await handleRequest(
      new Request("https://api.test/v1/artifacts/art_missing/revisions", {
        headers: { authorization: "Bearer ok" },
      }),
      {
        ...env,
        DB: operatorDbForTests({
          async listRevisions() {
            return null;
          },
        }),
      },
    );
    expect(missingResponse.status).toBe(404);

    const conflictResponse = await handleRequest(
      new Request(
        "https://api.test/v1/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/revisions/rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/publish",
        { method: "POST", headers: { authorization: "Bearer ok", "idempotency-key": "idem-conflict" } },
      ),
      {
        ...env,
        DB: operatorDbForTests({
          async publishRevision() {
            throw new Error("draft_revision_conflict");
          },
        }),
      },
    );
    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toMatchObject({ error: { code: "draft_revision_conflict" } });

    const retainedResponse = await handleRequest(
      new Request(
        "https://api.test/v1/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/revisions/rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/publish",
        { method: "POST", headers: { authorization: "Bearer ok", "idempotency-key": "idem-retained" } },
      ),
      {
        ...env,
        DB: operatorDbForTests({
          async publishRevision() {
            throw new Error("revision_retained");
          },
        }),
      },
    );
    expect(retainedResponse.status).toBe(410);

    const entrypointResponse = await handleRequest(
      new Request(
        "https://api.test/v1/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/revisions/rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/publish",
        { method: "POST", headers: { authorization: "Bearer ok", "idempotency-key": "idem-entrypoint" } },
      ),
      {
        ...env,
        DB: operatorDbForTests({
          async publishRevision() {
            throw new Error("entrypoint_not_in_revision");
          },
        }),
      },
    );
    expect(entrypointResponse.status).toBe(422);

    const bundleSend = vi.fn(async () => ({}));
    const malformedBundleResponse = await handleRequest(
      new Request(
        "https://api.test/v1/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/revisions/rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/publish",
        { method: "POST", headers: { authorization: "Bearer ok", "idempotency-key": "idem-bundle" } },
      ),
      {
        ...env,
        BUNDLE_GENERATE_QUEUE: { send: bundleSend },
        DB: operatorDbForTests({
          async publishRevision(input) {
            return {
              artifact_id: input.artifactId,
              revision_id: input.revisionId,
              title: "Demo",
              revision_content_url: "https://content.test/v/art.rev/index.html",
              agent_view_url: "https://api.test/v1/public/agent-view/art.rev",
              expires_at: "2026-02-01T00:00:00.000Z",
              bundle: null,
            } as never;
          },
        }),
      },
    );
    expect(malformedBundleResponse.status).toBe(200);
    expect(bundleSend).not.toHaveBeenCalled();
  });

  it("returns authenticated latest and revision Agent View with signed content URLs", async () => {
    const seen: unknown[] = [];
    const env: Env = {
      CONTENT_SIGNING_SECRET: "content-secret",
      CONTENT_BASE_URL: "https://content.test",
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["read"] };
        },
      },
      DB: operatorDbForTests({
        async getAgentView(input) {
          seen.push(input);
          return agentViewFixture(input.artifactId, input.revisionId ?? "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9");
        },
      }),
    };

    const latest = await handleRequest(
      new Request("https://api.test/v1/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/agent-view", {
        headers: { authorization: "Bearer ok" },
      }),
      env,
    );
    const revision = await handleRequest(
      new Request(
        "https://api.test/v1/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/revisions/rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/agent-view",
        { headers: { authorization: "Bearer ok" } },
      ),
      env,
    );

    expect(latest.status).toBe(200);
    expect(revision.status).toBe(200);
    const latestBody = (await latest.json()) as { revision_content_url: string; files?: Array<{ url?: string }> };
    expect(latestBody.revision_content_url).toContain("https://content.test/v/");
    expect(latestBody.revision_content_url).toContain("/index.html");
    expect(latestBody.revision_content_url).not.toBe("https://content.test/v/old/index.html");
    expect(latestBody.files?.[0]?.url).toContain("https://content.test/v/");
    expect(latestBody.files?.[0]?.url).not.toBe("https://content.test/v/old/index.html");
    const revisionBody = (await revision.json()) as { revision_content_url: string; files?: Array<{ url?: string }> };
    expect(revisionBody.revision_content_url).toContain("https://content.test/v/");
    expect(revisionBody.revision_content_url).toContain("/index.html");
    expect(revisionBody.revision_content_url).not.toBe("https://content.test/v/old/index.html");
    expect(revisionBody.files?.[0]?.url).toContain("https://content.test/v/");
    expect(revisionBody.files?.[0]?.url).not.toBe("https://content.test/v/old/index.html");
    expect(seen).toEqual([
      expect.objectContaining({ artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" }),
      expect.objectContaining({
        artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      }),
    ]);
  });

  it("exposes bundle availability per ADR 0050 and signs ready bundles with ADR 0021 keys", async () => {
    const workspaceId = "00000000-0000-4000-8000-000000000001";
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const bundleKey = `env/dev/workspaces/${workspaceId}/artifacts/${artifactId}/revisions/${revisionId}/bundle.zip`;
    const env: Env = {
      AGENT_PASTE_ENV: "dev",
      CONTENT_SIGNING_SECRET: "content-secret",
      CONTENT_BASE_URL: "https://content.test",
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: workspaceId, scopes: ["read"] };
        },
      },
      DB: operatorDbForTests({
        async getAgentView(input) {
          return {
            workspace_id: workspaceId,
            artifact_id: input.artifactId,
            revision_id: input.revisionId ?? revisionId,
            title: "Demo",
            created_at: "2026-01-01T00:00:00.000Z",
            expires_at: "2026-12-01T00:00:00.000Z",
            entrypoint: "index.html",
            revision_content_url: `https://content.test/v/${input.artifactId}.${input.revisionId ?? revisionId}/index.html`,
            files: [
              {
                path: "index.html",
                url: `https://content.test/v/${input.artifactId}.${input.revisionId ?? revisionId}/index.html`,
                content_type: "text/html",
                size_bytes: 1,
              },
            ],
            bundle: {
              status: "ready",
              size_bytes: 100,
              generated_at: "2026-01-01T00:00:00.000Z",
            },
          };
        },
        async getPublicAgentView() {
          return {
            workspace_id: workspaceId,
            artifact_id: artifactId,
            revision_id: revisionId,
            title: "Demo",
            created_at: "2026-01-01T00:00:00.000Z",
            expires_at: "2026-12-01T00:00:00.000Z",
            entrypoint: "index.html",
            revision_content_url: `https://content.test/v/${artifactId}.${revisionId}/index.html`,
            files: [
              {
                path: "index.html",
                url: `https://content.test/v/${artifactId}.${revisionId}/index.html`,
                content_type: "text/html",
                size_bytes: 1,
              },
            ],
            bundle: { status: "pending", retry_after_seconds: 5 },
          };
        },
      }),
    };

    const { verifyContentToken } = await import("@agent-paste/tokens/content");
    const readyResponse = await handleRequest(
      new Request(`https://api.test/v1/artifacts/${artifactId}/agent-view`, {
        headers: { authorization: "Bearer ok" },
      }),
      env,
    );
    expect(readyResponse.status).toBe(200);
    const readyBody = (await readyResponse.json()) as {
      workspace_id?: string;
      bundle?: { status: string; url?: string; size_bytes?: number; generated_at?: string };
    };
    expect(readyBody.workspace_id).toBeUndefined();
    expect(readyBody.bundle).toEqual({
      status: "ready",
      size_bytes: 100,
      generated_at: "2026-01-01T00:00:00.000Z",
      url: expect.stringMatching(/^https:\/\/content\.test\/b\//),
    });
    const readyBundleUrl = readyBody.bundle?.url;
    expect(readyBundleUrl).toBeDefined();
    if (!readyBundleUrl) {
      throw new Error("Expected a ready agent-view bundle URL");
    }
    const readyToken = decodeURIComponent(readyBundleUrl.split("/b/")[1] ?? "");
    const readyPayload = await verifyContentToken(readyToken, "content-secret");
    expect(readyPayload?.key_prefix).toBe(bundleKey);

    const signed = await mintAgentViewToken(
      { artifact_id: artifactId, revision_id: revisionId, exp: Math.floor(Date.now() / 1000) + 3600 },
      "agent-view-secret",
    );
    const pendingEnv: Env = {
      ...env,
      AGENT_VIEW_SIGNING_SECRET: "agent-view-secret",
    };
    const pendingResponse = await handleRequest(
      new Request(`https://api.test/v1/public/agent-view/${signed}`),
      pendingEnv,
    );
    expect(pendingResponse.status).toBe(200);
    const pendingBody = (await pendingResponse.json()) as { bundle?: Record<string, unknown> };
    expect(pendingBody.bundle).toEqual({ status: "pending", retry_after_seconds: 5 });
    expect(pendingBody.bundle).not.toHaveProperty("url");
  });

  it("strips internal workspace_id when content signing is not configured", async () => {
    const workspaceId = "00000000-0000-4000-8000-000000000001";
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const env: Env = {
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: workspaceId, scopes: ["read"] };
        },
      },
      DB: operatorDbForTests({
        async getAgentView() {
          return {
            workspace_id: workspaceId,
            artifact_id: artifactId,
            revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
            title: "Demo",
            created_at: "2026-01-01T00:00:00.000Z",
            expires_at: "2026-12-01T00:00:00.000Z",
            entrypoint: "index.html",
            revision_content_url: "https://content.test/v/old/index.html",
            files: [
              {
                path: "index.html",
                url: "https://content.test/v/old/index.html",
                content_type: "text/html",
                size_bytes: 1,
              },
            ],
            bundle: { status: "ready", size_bytes: 10, generated_at: "2026-01-01T00:00:00.000Z" },
          };
        },
      }),
    };

    const response = await handleRequest(
      new Request(`https://api.test/v1/artifacts/${artifactId}/agent-view`, {
        headers: { authorization: "Bearer ok" },
      }),
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { workspace_id?: string; bundle?: { url?: string } };
    expect(body.workspace_id).toBeUndefined();
    expect(body.bundle?.url).toBeUndefined();
  });

  it("returns not_found for missing authenticated and public Agent Views", async () => {
    const signed = await mintAgentViewToken(
      {
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      "agent-view-secret",
    );
    const env: Env = {
      AGENT_VIEW_SIGNING_SECRET: "agent-view-secret",
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["read"] };
        },
      },
      DB: operatorDbForTests({
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
      }),
    };

    const authenticated = await handleRequest(
      new Request("https://api.test/v1/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/agent-view", {
        headers: { authorization: "Bearer ok" },
      }),
      env,
    );
    const publicResponse = await handleRequest(new Request(`https://api.test/v1/public/agent-view/${signed}`), env);

    expect(authenticated.status).toBe(404);
    expect(publicResponse.status).toBe(404);
  });

  it("serves non-production force-expire, R2 list, and denylist helpers", async () => {
    const deleted: unknown[] = [];
    const env: Env = {
      AGENT_PASTE_ENV: "preview",
      SMOKE_HARNESS_SECRET: "harness",
      DB: operatorDbForTests({
        async forceExpireArtifact(input) {
          return input.artifactId === "art_ok" ? { artifact_id: input.artifactId, expires_at: input.expiresAt } : null;
        },
      }),
      ARTIFACTS: {
        async list(options) {
          return options.cursor
            ? { objects: [{ key: "artifacts/art_ok/two.txt" }], truncated: false }
            : { objects: [{ key: "artifacts/art_ok/one.txt" }], truncated: true, cursor: "next" };
        },
        async delete(keys) {
          deleted.push(keys);
        },
      },
      DENYLIST: {
        async put() {},
        async delete() {},
        async get(key) {
          return key === "ad:art_ok" ? "locked" : null;
        },
      },
    };
    const headers = { authorization: "Bearer harness", "content-type": "application/json" };

    const force = await handleRequest(
      new Request("https://api.test/__test__/force-expire", {
        method: "POST",
        headers,
        body: JSON.stringify({ artifact_id: "art_ok" }),
      }),
      env,
    );
    const r2 = await handleRequest(
      new Request("https://api.test/__test__/r2-list?prefix=artifacts/art_ok/", { headers }),
      env,
    );
    const deny = await handleRequest(new Request("https://api.test/__test__/denylist?key=ad:art_ok", { headers }), env);
    const missing = await handleRequest(
      new Request("https://api.test/__test__/force-expire", {
        method: "POST",
        headers,
        body: JSON.stringify({ artifact_id: "art_missing" }),
      }),
      env,
    );

    expect(force.status).toBe(200);
    await expect(r2.json()).resolves.toEqual({
      keys: ["artifacts/art_ok/one.txt", "artifacts/art_ok/two.txt"],
      r2_bound: true,
    });
    await expect(deny.json()).resolves.toEqual({ key: "ad:art_ok", value: "locked", kv_bound: true });
    expect(missing.status).toBe(404);
    expect(deleted).toEqual([]);
  });
});

describe("api security headers", () => {
  function expectBaseline(response: Response): void {
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  }

  it("applies the baseline to /healthz and /openapi.json", async () => {
    expectBaseline(await handleRequest(new Request("https://api.test/healthz"), {}));
    expectBaseline(await handleRequest(new Request("https://api.test/openapi.json"), {}));
  });

  it("applies the baseline to 404 responses", async () => {
    expectBaseline(await handleRequest(new Request("https://api.test/nope"), {}));
  });

  it("applies the baseline to a 2xx JSON response and keeps no-store", async () => {
    const env: Env = {
      AUTH: {
        async verifyApiKey(apiKey) {
          return apiKey === "ok" ? { type: "api_key", id: "key_1", workspace_id: "w_1" } : null;
        },
      },
      DB: {
        async getWhoami(actor) {
          return { actor };
        },
        async getAgentView() {
          return null;
        },
        async getPublicAgentView() {
          return null;
        },
        async runCleanup() {
          return {};
        },
      },
    };
    const response = await handleRequest(
      new Request("https://api.test/v1/whoami", { headers: { authorization: "Bearer ok" } }),
      env,
    );
    expect(response.status).toBe(200);
    expectBaseline(response);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("web Access Link routes", () => {
  const ARTIFACT_ID = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
  const ACCESS_LINK_ID = "al_test_link";

  function accessLinkRow(overrides: Record<string, unknown> = {}) {
    return {
      id: ACCESS_LINK_ID,
      type: "share",
      artifact_id: ARTIFACT_ID,
      revision_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      revoked_at: null,
      revoked: false,
      ...overrides,
    };
  }

  it("lists access links workspace-wide for a member", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["read"], {
        async listWorkspaceAccessLinks(actor) {
          expect(actor).toMatchObject({ type: "member" });
          return { items: [accessLinkRow()], page_info: { next_cursor: null, has_more: false } };
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/access-links", { headers: { authorization: "Bearer workos-ok" } }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ items: [{ id: ACCESS_LINK_ID, revoked: false }] });
  });

  it("rejects non-members on the workspace access link list", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["read"], {
        async getWebMemberByWorkOsUserId() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["read"] };
        },
        async listWorkspaceAccessLinks() {
          throw new Error("should not run for non-members");
        },
      }),
    };

    const response = await handleRequest(
      new Request("https://api.test/v1/web/access-links", { headers: { authorization: "Bearer workos-ok" } }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it.each([
    [
      "create",
      `https://api.test/v1/web/artifacts/${ARTIFACT_ID}/access-links`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "idem-al-create-read-only" },
        body: JSON.stringify({ type: "share" }),
      },
    ],
    ["mint", `https://api.test/v1/web/access-links/${ACCESS_LINK_ID}/mint`, { method: "POST", headers: {} }],
    ["revoke", `https://api.test/v1/web/access-links/${ACCESS_LINK_ID}/revoke`, { method: "POST", headers: {} }],
    [
      "lockdownSet",
      `https://api.test/v1/web/artifacts/${ARTIFACT_ID}/access-link-lockdown`,
      { method: "POST", headers: { "idempotency-key": "idem-lockdown-read-only" } },
    ],
    [
      "lockdownLift",
      `https://api.test/v1/web/artifacts/${ARTIFACT_ID}/access-link-lockdown/lift`,
      { method: "POST", headers: { "idempotency-key": "idem-lockdown-lift-read-only" } },
    ],
  ])("rejects read-only members before web access link %s mutations run", async (_label, url, init) => {
    const createMemberAccessLink = vi.fn(async () => {
      throw new Error("create should not run for a read-only member");
    });
    const mintMemberAccessLink = vi.fn(async () => {
      throw new Error("mint should not run for a read-only member");
    });
    const revokeMemberAccessLink = vi.fn(async () => {
      throw new Error("revoke should not run for a read-only member");
    });
    const setMemberAccessLinkLockdown = vi.fn(async () => {
      throw new Error("lockdown should not run for a read-only member");
    });
    const env: Env = {
      ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret",
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["read"], {
        createMemberAccessLink,
        mintMemberAccessLink,
        revokeMemberAccessLink,
        setMemberAccessLinkLockdown,
      }),
      DENYLIST: {
        put: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
    };

    const response = await handleRequest(
      new Request(url, {
        ...init,
        headers: {
          authorization: "Bearer workos-ok",
          ...init.headers,
        },
      }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
    expect(createMemberAccessLink).not.toHaveBeenCalled();
    expect(mintMemberAccessLink).not.toHaveBeenCalled();
    expect(revokeMemberAccessLink).not.toHaveBeenCalled();
    expect(setMemberAccessLinkLockdown).not.toHaveBeenCalled();
  });

  it("lists access links for an artifact and 404s when the artifact is unknown", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["read"], {
        async listWebArtifactAccessLinks(_actor, artifactId) {
          return artifactId === ARTIFACT_ID
            ? { items: [accessLinkRow()], page_info: { next_cursor: null, has_more: false } }
            : null;
        },
      }),
    };

    const ok = await handleRequest(
      new Request(`https://api.test/v1/web/artifacts/${ARTIFACT_ID}/access-links`, {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ items: [{ id: ACCESS_LINK_ID }] });

    const missing = await handleRequest(
      new Request("https://api.test/v1/web/artifacts/art_missing/access-links", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "artifact_not_found" } });
  });

  it("creates an access link from the member workspace", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["publish", "read", "admin"], {
        async createMemberAccessLink(input) {
          expect(input).toMatchObject({ artifactId: ARTIFACT_ID, type: "share", idempotencyKey: "idem-al-create" });
          return {
            id: ACCESS_LINK_ID,
            type: "share",
            artifact_id: ARTIFACT_ID,
            revision_id: null,
            created_at: "2026-01-01T00:00:00.000Z",
          };
        },
      }),
    };

    const response = await handleRequest(
      new Request(`https://api.test/v1/web/artifacts/${ARTIFACT_ID}/access-links`, {
        method: "POST",
        headers: {
          authorization: "Bearer workos-ok",
          "content-type": "application/json",
          "idempotency-key": "idem-al-create",
        },
        body: JSON.stringify({ type: "share" }),
      }),
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: ACCESS_LINK_ID, type: "share" });
  });

  it("returns database_unavailable when the access link signer is unset on mint", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["publish", "read", "admin"], {
        async mintMemberAccessLink() {
          throw new Error("mint should not run without a signer");
        },
      }),
    };

    const response = await handleRequest(
      new Request(`https://api.test/v1/web/access-links/${ACCESS_LINK_ID}/mint`, {
        method: "POST",
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "database_unavailable" } });
  });

  it("mints a signed URL for an access link", async () => {
    const env: Env = {
      ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret",
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["publish", "read", "admin"], {
        async mintMemberAccessLink(input) {
          expect(input).toMatchObject({ accessLinkId: ACCESS_LINK_ID });
          return { url: `https://app.agent-paste.sh/al/0123456789ABCDEF#blob` };
        },
      }),
    };

    const response = await handleRequest(
      new Request(`https://api.test/v1/web/access-links/${ACCESS_LINK_ID}/mint`, {
        method: "POST",
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ url: expect.stringContaining("/al/") });
  });

  it("revokes an access link", async () => {
    const puts: Array<{ key: string; value: string; expirationTtl?: number }> = [];
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["publish", "read", "admin"], {
        async revokeMemberAccessLink(input) {
          expect(input).toMatchObject({ accessLinkId: ACCESS_LINK_ID });
          return { access_link_id: ACCESS_LINK_ID, revoked_at: "2026-01-02T00:00:00.000Z" };
        },
      }),
      DENYLIST: {
        async put(key, value, options) {
          puts.push({ key, value, expirationTtl: options?.expirationTtl });
        },
      },
    };

    const response = await handleRequest(
      new Request(`https://api.test/v1/web/access-links/${ACCESS_LINK_ID}/revoke`, {
        method: "POST",
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ access_link_id: ACCESS_LINK_ID });
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ key: `ald:${ACCESS_LINK_ID}` });
    expect(JSON.parse(puts[0]?.value ?? "{}")).toMatchObject({ reason: "revocation", at: expect.any(String) });
  });

  // revoke self-dedupes through uow.command, so a concurrent collision still
  // surfaces idempotency_in_flight even though the route carries no client key.
  it("maps a concurrent revoke collision to idempotency_in_flight", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["publish", "read", "admin"], {
        async revokeMemberAccessLink() {
          throw new IdempotencyInFlightError();
        },
      }),
    };

    const response = await handleRequest(
      new Request(`https://api.test/v1/web/access-links/${ACCESS_LINK_ID}/revoke`, {
        method: "POST",
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "idempotency_in_flight" } });
  });

  it.each([
    ["set", `https://api.test/v1/web/artifacts/${ARTIFACT_ID}/access-link-lockdown`, true],
    ["lift", `https://api.test/v1/web/artifacts/${ARTIFACT_ID}/access-link-lockdown/lift`, false],
  ])("%ss Access Link Lockdown for an artifact", async (_label, url, expectedLocked) => {
    const puts: Array<{ key: string; value: string }> = [];
    const deletes: string[] = [];
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["publish", "read", "admin"], {
        async setMemberAccessLinkLockdown(input) {
          expect(input).toMatchObject({ artifactId: ARTIFACT_ID, locked: expectedLocked });
          return {
            id: ARTIFACT_ID,
            title: "Demo",
            status: "Published",
            latest_revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
            pinned: false,
            lockdown: expectedLocked,
            last_published_at: "2026-01-01T00:00:00.000Z",
            auto_delete_at: null,
            entrypoint: "index.html",
            file_count: 1,
            size_bytes: 12,
            viewer: null,
          };
        },
      }),
      DENYLIST: {
        async put(key, value) {
          puts.push({ key, value });
        },
        async delete(key) {
          deletes.push(key);
        },
      },
    };

    const response = await handleRequest(
      new Request(url, {
        method: "POST",
        headers: { authorization: "Bearer workos-ok", "idempotency-key": "idem-lockdown" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: ARTIFACT_ID, lockdown: expectedLocked });
    if (expectedLocked) {
      expect(puts).toHaveLength(1);
      expect(puts[0]).toMatchObject({ key: `ad:${ARTIFACT_ID}` });
      expect(JSON.parse(puts[0]?.value ?? "{}")).toMatchObject({
        reason: "access_link_lockdown",
        at: expect.any(String),
      });
      expect(deletes).toEqual([]);
    } else {
      expect(deletes).toEqual([`ad:${ARTIFACT_ID}`]);
      expect(puts).toEqual([]);
    }
  });

  it.each([
    ["listForArtifact", `https://api.test/v1/web/artifacts/${ARTIFACT_ID}/access-links`, { method: "GET" }],
    [
      "create",
      `https://api.test/v1/web/artifacts/${ARTIFACT_ID}/access-links`,
      { method: "POST", body: JSON.stringify({ type: "share" }) },
    ],
    ["mint", `https://api.test/v1/web/access-links/${ACCESS_LINK_ID}/mint`, { method: "POST" }],
    ["revoke", `https://api.test/v1/web/access-links/${ACCESS_LINK_ID}/revoke`, { method: "POST" }],
    ["lockdownSet", `https://api.test/v1/web/artifacts/${ARTIFACT_ID}/access-link-lockdown`, { method: "POST" }],
    ["lockdownLift", `https://api.test/v1/web/artifacts/${ARTIFACT_ID}/access-link-lockdown/lift`, { method: "POST" }],
  ])("rejects non-members on web access link %s routes", async (_label, url, init) => {
    const env: Env = {
      ACCESS_LINK_SIGNING_KEY_V1: "access-link-secret",
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["read"], {
        async getWebMemberByWorkOsUserId() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["admin"] };
        },
      }),
    };

    const response = await handleRequest(
      new Request(url, {
        ...init,
        headers: {
          authorization: "Bearer workos-ok",
          "content-type": "application/json",
          "idempotency-key": "idem-forbidden",
        },
      }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it.each([
    ["list", "https://api.test/v1/web/access-links", { method: "GET" }],
    [
      "create",
      `https://api.test/v1/web/artifacts/${ARTIFACT_ID}/access-links`,
      { method: "POST", body: JSON.stringify({ type: "share" }) },
    ],
  ])("rejects API keys on web access link %s routes", async (_label, url, init) => {
    const env: Env = {
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["admin"] };
        },
      },
      DB: baseDbForTests(),
    };

    const response = await handleRequest(
      new Request(url, {
        ...init,
        headers: {
          authorization: "Bearer ap_pk_preview_fake",
          "content-type": "application/json",
          "idempotency-key": "idem-1",
        },
      }),
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
  });

  it("lists revisions for an artifact and 404s when the artifact is unknown", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["read"], {
        async listRevisions({ actor, artifactId }) {
          expect(actor).toMatchObject({ type: "member" });
          return artifactId === ARTIFACT_ID
            ? {
                artifact_id: ARTIFACT_ID,
                items: [
                  {
                    revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
                    revision_number: 1,
                    status: "published",
                    entrypoint: "index.html",
                    render_mode: "html",
                    file_count: 1,
                    size_bytes: 12,
                    created_at: "2026-01-01T00:00:00.000Z",
                    published_at: "2026-01-01T00:00:00.000Z",
                  },
                ],
                page_info: { next_cursor: null, has_more: false },
              }
            : null;
        },
      }),
    };

    const ok = await handleRequest(
      new Request(`https://api.test/v1/web/artifacts/${ARTIFACT_ID}/revisions`, {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({
      artifact_id: ARTIFACT_ID,
      items: [{ revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" }],
    });

    const missing = await handleRequest(
      new Request("https://api.test/v1/web/artifacts/art_missing/revisions", {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "artifact_not_found" } });
  });

  it("rejects non-members on the web revisions list route", async () => {
    const env: Env = {
      AUTH: webAuthForTests(),
      DB: webMemberDbForTests(["read"], {
        async getWebMemberByWorkOsUserId() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["admin"] };
        },
        async listRevisions() {
          throw new Error("listRevisions should not run for a non-member");
        },
      }),
    };

    const response = await handleRequest(
      new Request(`https://api.test/v1/web/artifacts/${ARTIFACT_ID}/revisions`, {
        headers: { authorization: "Bearer workos-ok" },
      }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });
});

function webAuthForTests(role = "admin"): Env["AUTH"] {
  return {
    async verifyApiKey() {
      return null;
    },
    async verifyWebToken(token) {
      return token === "workos-ok"
        ? { workos_user_id: "user_1", email: "user@example.com", token_id: "jti_1", role }
        : null;
    },
  };
}

function agentViewFixture(artifactId: string, revisionId: string) {
  return {
    artifact_id: artifactId,
    revision_id: revisionId,
    title: "Agent View",
    entrypoint: "index.html",
    expires_at: "2026-12-01T00:00:00.000Z",
    revision_content_url: "https://content.test/v/old/index.html",
    files: [
      { path: "index.html", url: "https://content.test/v/old/index.html", content_type: "text/html", size_bytes: 12 },
    ],
  };
}

function baseDbForTests(): ApiDatabase {
  return {
    async getWhoami() {
      return {};
    },
    async getAgentView() {
      return null;
    },
    async getPublicAgentView() {
      return null;
    },
    async runCleanup() {
      return {};
    },
  };
}

function operatorDbForTests(overrides: Partial<ApiDatabase> = {}): ApiDatabase {
  return {
    ...baseDbForTests(),
    async peekArtifactPlatformLockdownRetention() {
      return false;
    },
    ...overrides,
  };
}

function lockdownDetail(overrides: Record<string, unknown> = {}) {
  return {
    scope: "workspace",
    target_id: "w_123",
    reason_code: "abuse",
    set_at: "2026-01-01T00:00:00.000Z",
    set_by: "user@example.com",
    lifted_at: null,
    lifted_by: null,
    ...overrides,
  };
}

function webMemberDbForTests(scopes: string[], overrides: Partial<ApiDatabase> = {}): ApiDatabase {
  return {
    ...baseDbForTests(),
    async peekArtifactDenylistRetention() {
      return false;
    },
    async getWebMemberByWorkOsUserId() {
      return {
        type: "member",
        id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
        workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
        scopes,
      };
    },
    async ensureWebMember() {
      return {
        type: "member",
        id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
        workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
        email: "user@example.com",
        scopes,
      };
    },
    ...overrides,
  };
}
