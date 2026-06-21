import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mintAgentAuthServiceAssertion,
  parseAgentAuthTrustedProviders,
  verifyAgentAuthServiceAssertion,
  verifyAgentProviderIdentityAssertion,
  verifyAgentProviderSecurityEvent,
} from "./agent-auth.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent auth helpers", () => {
  it("parses trusted provider config", () => {
    const providers = parseAgentAuthTrustedProviders(
      JSON.stringify([
        {
          issuer: "https://provider.example/",
          display_name: "Provider",
          jwks_uri: "https://provider.example/jwks",
          client_ids: ["client_1"],
          algorithms: ["RS256"],
        },
      ]),
    );
    expect(providers).toEqual([
      {
        issuer: "https://provider.example",
        displayName: "Provider",
        jwksUri: "https://provider.example/jwks",
        clientIds: ["client_1"],
        algorithms: ["RS256"],
      },
    ]);
  });

  it("parses trusted provider aliases without optional fields", () => {
    const providers = parseAgentAuthTrustedProviders(
      JSON.stringify([
        {
          issuer: "https://provider.example/",
          displayName: "Provider",
          clientIds: ["client_1", "", null],
        },
      ]),
    );

    expect(providers).toEqual([
      {
        issuer: "https://provider.example",
        displayName: "Provider",
        clientIds: ["client_1"],
      },
    ]);
  });

  it("rejects malformed trusted provider URLs", () => {
    expect(() =>
      parseAgentAuthTrustedProviders(
        JSON.stringify([{ issuer: "not a url", display_name: "Provider", client_ids: ["client_1"] }]),
      ),
    ).toThrow("agent_auth_trusted_provider_invalid_issuer_url");
    expect(() =>
      parseAgentAuthTrustedProviders(
        JSON.stringify([{ issuer: "http://provider.example", display_name: "Provider", client_ids: ["client_1"] }]),
      ),
    ).toThrow("agent_auth_trusted_provider_invalid_issuer_url");
    expect(() =>
      parseAgentAuthTrustedProviders(
        JSON.stringify([
          {
            issuer: "https://provider.example",
            display_name: "Provider",
            client_ids: ["client_1"],
            jwks_uri: "not a url",
          },
        ]),
      ),
    ).toThrow("agent_auth_trusted_provider_invalid_jwks_uri");
  });

  it("rejects malformed trusted provider entries", () => {
    expect(parseAgentAuthTrustedProviders(undefined)).toEqual([]);
    expect(parseAgentAuthTrustedProviders("  ")).toEqual([]);
    expect(() => parseAgentAuthTrustedProviders(JSON.stringify({}))).toThrow(
      "agent_auth_trusted_providers_must_be_array",
    );
    expect(() => parseAgentAuthTrustedProviders(JSON.stringify([null]))).toThrow(
      "agent_auth_trusted_provider_must_be_object",
    );
    expect(() => parseAgentAuthTrustedProviders(JSON.stringify([{}]))).toThrow(
      "agent_auth_trusted_provider_missing_required_fields",
    );
  });

  it("mints and verifies service identity assertions", async () => {
    const now = new Date("2026-06-20T12:00:00.000Z");
    const assertion = await mintAgentAuthServiceAssertion({
      issuer: "https://api.example",
      secret: "test-secret",
      registrationId: "reg_123",
      scopes: ["read", "publish"],
      expiresAt: new Date("2026-06-20T13:00:00.000Z"),
      now,
    });
    await expect(
      verifyAgentAuthServiceAssertion({
        assertion,
        issuer: "https://api.example",
        secret: "test-secret",
        now,
      }),
    ).resolves.toMatchObject({
      registration_id: "reg_123",
      registration_type: "identity_assertion",
      scopes: ["read", "publish"],
      issued_at: "2026-06-20T12:00:00.000Z",
      exp: 1781960400,
    });
    await expect(
      verifyAgentAuthServiceAssertion({
        assertion,
        issuer: "https://api.example",
        secret: "wrong-secret",
        now,
      }),
    ).resolves.toBeNull();
  });

  it("mints and verifies anonymous service identity assertions", async () => {
    const now = new Date("2026-06-20T12:00:00.000Z");
    const assertion = await mintAgentAuthServiceAssertion({
      issuer: "https://api.example",
      secret: "test-secret",
      registrationId: "reg_anon",
      registrationType: "anonymous",
      anonymousClaimState: "post_claim",
      scopes: ["read", "publish"],
      expiresAt: new Date("2026-06-27T12:00:00.000Z"),
      now,
    });
    await expect(
      verifyAgentAuthServiceAssertion({
        assertion,
        issuer: "https://api.example",
        secret: "test-secret",
        now,
      }),
    ).resolves.toMatchObject({
      registration_id: "reg_anon",
      registration_type: "anonymous",
      anonymous_claim_state: "post_claim",
      scopes: ["read", "publish"],
      issued_at: "2026-06-20T12:00:00.000Z",
    });
  });

  it("rejects invalid service identity assertions", async () => {
    const now = new Date("2026-06-20T12:00:00.000Z");
    const wrongType = await new SignJWT({
      registration_type: "identity_assertion",
      scopes: ["read"],
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("https://api.example")
      .setAudience("https://api.example")
      .setSubject("reg_123")
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 3600)
      .sign(new TextEncoder().encode("test-secret"));
    await expect(
      verifyAgentAuthServiceAssertion({
        assertion: wrongType,
        issuer: "https://api.example",
        secret: "test-secret",
        now,
      }),
    ).resolves.toBeNull();

    const missingAnonymousState = await new SignJWT({
      registration_type: "anonymous",
      anonymous_claim_state: "unknown",
      scopes: ["read"],
    })
      .setProtectedHeader({ alg: "HS256", typ: "oauth-id-jag+jwt" })
      .setIssuer("https://api.example")
      .setAudience("https://api.example")
      .setSubject("reg_123")
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 3600)
      .sign(new TextEncoder().encode("test-secret"));
    await expect(
      verifyAgentAuthServiceAssertion({
        assertion: missingAnonymousState,
        issuer: "https://api.example",
        secret: "test-secret",
        now,
      }),
    ).resolves.toBeNull();

    const missingSubject = await new SignJWT({
      registration_type: "identity_assertion",
      scopes: ["read"],
    })
      .setProtectedHeader({ alg: "HS256", typ: "oauth-id-jag+jwt" })
      .setIssuer("https://api.example")
      .setAudience("https://api.example")
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 3600)
      .sign(new TextEncoder().encode("test-secret"));
    await expect(
      verifyAgentAuthServiceAssertion({
        assertion: missingSubject,
        issuer: "https://api.example",
        secret: "test-secret",
        now,
      }),
    ).resolves.toBeNull();
  });

  it("verifies provider identity assertions and security events", async () => {
    const fixture = await trustedProviderFixture();
    const now = new Date("2026-06-20T12:00:00.000Z");
    const identityAssertion = await signProviderJwt(fixture, { now, typ: "oauth-id-jag+jwt" });

    await expect(
      verifyAgentProviderIdentityAssertion(identityAssertion, {
        audience: "https://api.example",
        trustedProviders: [fixture.provider],
        now,
      }),
    ).resolves.toMatchObject({
      issuer: fixture.provider.issuer,
      subject: "user_123",
      clientId: "client_1",
      email: "person@example.test",
      providerDisplayName: "Provider",
    });

    const securityEvent = await signProviderJwt(fixture, {
      now,
      typ: "secevent+jwt",
      payload: { events: { "https://schemas.openid.net/secevent/risc/event-type/account-disabled": {} } },
    });
    await expect(
      verifyAgentProviderSecurityEvent(securityEvent, {
        audience: "https://api.example",
        trustedProviders: [fixture.provider],
        now,
      }),
    ).resolves.toMatchObject({
      issuer: fixture.provider.issuer,
      subject: "user_123",
      eventTypes: ["https://schemas.openid.net/secevent/risc/event-type/account-disabled"],
    });
  });

  it("maps provider assertion failures to stable verification errors", async () => {
    const fixture = await trustedProviderFixture();
    const now = new Date("2026-06-20T12:00:00.000Z");

    await expect(
      verifyAgentProviderIdentityAssertion("not.jwt", {
        audience: "https://api.example",
        trustedProviders: [fixture.provider],
        now,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });

    await expect(
      verifyAgentProviderIdentityAssertion(await signProviderJwt(fixture, { now, typ: "secevent+jwt" }), {
        audience: "https://api.example",
        trustedProviders: [fixture.provider],
        now,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });

    await expect(
      verifyAgentProviderIdentityAssertion(
        await signProviderJwt(fixture, { now, issuer: "https://unknown.example", typ: "oauth-id-jag+jwt" }),
        {
          audience: "https://api.example",
          trustedProviders: [fixture.provider],
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_issuer" });

    await expect(
      verifyAgentProviderIdentityAssertion(
        await signProviderJwt(fixture, { now, audience: "https://other.example", typ: "oauth-id-jag+jwt" }),
        {
          audience: "https://api.example",
          trustedProviders: [fixture.provider],
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_audience" });

    await expect(
      verifyAgentProviderIdentityAssertion(
        await signProviderJwt(fixture, {
          now,
          audience: ["https://other.example"],
          typ: "oauth-id-jag+jwt",
        }),
        {
          audience: "https://api.example",
          trustedProviders: [fixture.provider],
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_audience" });

    await expect(
      verifyAgentProviderIdentityAssertion(
        await signProviderJwt(fixture, { now, typ: "oauth-id-jag+jwt", expired: true }),
        {
          audience: "https://api.example",
          trustedProviders: [fixture.provider],
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "expired" });

    await expect(
      verifyAgentProviderIdentityAssertion(
        await signProviderJwt(fixture, { now, typ: "oauth-id-jag+jwt", payload: { client_id: "other" } }),
        {
          audience: "https://api.example",
          trustedProviders: [fixture.provider],
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_client_id" });

    await expect(
      verifyAgentProviderIdentityAssertion(
        await signProviderJwt(fixture, { now, typ: "oauth-id-jag+jwt", payload: { email_verified: false } }),
        {
          audience: "https://api.example",
          trustedProviders: [fixture.provider],
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "missing_verified_email" });

    await expect(
      verifyAgentProviderIdentityAssertion(
        await signProviderJwt(fixture, {
          now,
          typ: "oauth-id-jag+jwt",
          payload: { auth_time: Math.floor(now.getTime() / 1000) - 120 },
        }),
        {
          audience: "https://api.example",
          trustedProviders: [fixture.provider],
          maxAuthAgeSeconds: 60,
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "login_required", maxAge: 60 });

    await expect(
      verifyAgentProviderIdentityAssertion(
        await signProviderJwt(fixture, {
          now,
          typ: "oauth-id-jag+jwt",
          payload: {
            auth_time: Math.floor(now.getTime() / 1000) + 300,
            iat: Math.floor(now.getTime() / 1000) + 300,
          },
        }),
        {
          audience: "https://api.example",
          trustedProviders: [fixture.provider],
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });

    await expect(
      verifyAgentProviderSecurityEvent(
        await signProviderJwt(fixture, {
          now,
          typ: "secevent+jwt",
          payload: { events: [] },
        }),
        {
          audience: "https://api.example",
          trustedProviders: [fixture.provider],
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});

async function trustedProviderFixture() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const kid = `kid-${crypto.randomUUID()}`;
  jwk.kid = kid;
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } }),
  );
  return {
    kid,
    privateKey,
    provider: {
      issuer: "https://provider.example",
      displayName: "Provider",
      jwksUri: `https://provider.example/${kid}/jwks.json`,
      clientIds: ["client_1"],
      algorithms: ["RS256"],
    },
  };
}

async function signProviderJwt(
  fixture: Awaited<ReturnType<typeof trustedProviderFixture>>,
  input: {
    now: Date;
    typ: "oauth-id-jag+jwt" | "secevent+jwt";
    issuer?: string;
    audience?: string | string[];
    expired?: boolean;
    payload?: Record<string, unknown>;
  },
) {
  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  const payload = {
    client_id: "client_1",
    auth_time: nowSeconds,
    email: "Person@Example.Test",
    email_verified: true,
    ...input.payload,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", typ: input.typ, kid: fixture.kid })
    .setIssuer(input.issuer ?? fixture.provider.issuer)
    .setAudience(input.audience ?? "https://api.example")
    .setSubject("user_123")
    .setJti(`jti-${crypto.randomUUID()}`)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(input.expired ? nowSeconds - 300 : nowSeconds + 300)
    .sign(fixture.privateKey);
}
