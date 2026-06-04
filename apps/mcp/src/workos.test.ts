import { MCP_RESOURCE_INDICATOR } from "@agent-paste/contracts";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { audienceFromPayload, isConfiguredMcpOAuthVerifier, verifyMcpOAuthToken } from "./workos.js";

const subject = "user_01";
const jwksUrl = "https://tenant.authkit.app/oauth2/jwks";
const issuer = "https://tenant.authkit.app";
let keyPairPromise: ReturnType<typeof generateKeyPair> | undefined;

describe("MCP WorkOS token verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("verifies a token for the MCP resource indicator", async () => {
    const fixture = await tokenFixture({ scope: "write read" });
    stubJwks(fixture.publicJwk);

    const verified = await verifyMcpOAuthToken(fixture.token, {
      WORKOS_API_KEY: "sk_test",
      WORKOS_MCP_JWKS_URL: jwksUrl,
      WORKOS_MCP_ISSUER: issuer,
      WORKOS_MCP_AUDIENCE: MCP_RESOURCE_INDICATOR,
    });

    expect(verified).toEqual({ tokenSub: subject });
  });

  it("checks audience membership", () => {
    expect(audienceFromPayload({ aud: MCP_RESOURCE_INDICATOR }, MCP_RESOURCE_INDICATOR)).toBe(true);
    expect(audienceFromPayload({ aud: ["other", MCP_RESOURCE_INDICATOR] }, MCP_RESOURCE_INDICATOR)).toBe(true);
    expect(audienceFromPayload({ aud: "https://other.example" }, MCP_RESOURCE_INDICATOR)).toBe(false);
    expect(audienceFromPayload({ aud: [123, MCP_RESOURCE_INDICATOR] }, MCP_RESOURCE_INDICATOR)).toBe(true);
  });

  it("returns null when verification prerequisites are missing", async () => {
    expect(isConfiguredMcpOAuthVerifier({})).toBe(false);
    expect(isConfiguredMcpOAuthVerifier({ WORKOS_API_KEY: "sk_test" })).toBe(false);
    expect(isConfiguredMcpOAuthVerifier({ WORKOS_API_KEY: "sk_test", WORKOS_CLI_JWKS_URL: jwksUrl })).toBe(true);

    await expect(verifyMcpOAuthToken("token", {})).resolves.toBeNull();
    await expect(verifyMcpOAuthToken("token", { WORKOS_API_KEY: "sk_test" })).resolves.toBeNull();
  });

  it("rejects wrong issuer, audience, and expired tokens", async () => {
    const fixture = await tokenFixture({ scope: "read" });
    stubJwks(fixture.publicJwk);

    await expect(
      verifyMcpOAuthToken(fixture.token, {
        WORKOS_API_KEY: "sk_test",
        WORKOS_MCP_JWKS_URL: jwksUrl,
        WORKOS_MCP_ISSUER: "https://wrong-issuer.example",
      }),
    ).resolves.toBeNull();

    const wrongAud = await tokenFixture({ scope: "read", audience: "https://wrong.example" });
    await expect(
      verifyMcpOAuthToken(wrongAud.token, {
        WORKOS_API_KEY: "sk_test",
        WORKOS_MCP_JWKS_URL: jwksUrl,
        WORKOS_MCP_ISSUER: issuer,
      }),
    ).resolves.toBeNull();

    const expired = await expiredFixture();
    await expect(
      verifyMcpOAuthToken(expired.token, {
        WORKOS_API_KEY: "sk_test",
        WORKOS_MCP_JWKS_URL: jwksUrl,
        WORKOS_MCP_ISSUER: issuer,
      }),
    ).resolves.toBeNull();
  });

  it("falls back to CLI issuer and JWKS settings", async () => {
    const fixture = await tokenFixture({ scope: "read" });
    stubJwks(fixture.publicJwk);

    const verified = await verifyMcpOAuthToken(fixture.token, {
      WORKOS_API_KEY: "sk_test",
      WORKOS_CLI_JWKS_URL: jwksUrl,
      WORKOS_CLI_ISSUER: issuer,
      MCP_RESOURCE: MCP_RESOURCE_INDICATOR,
    });
    expect(verified?.tokenSub).toBe(subject);
  });

  it("reuses cached JWKS fetchers", async () => {
    const cacheJwksUrl = "https://tenant.authkit.app/oauth2/jwks-cache-only";
    const fixture = await tokenFixture({ scope: "read" });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url);
      if (href === cacheJwksUrl) {
        return Response.json({ keys: [fixture.publicJwk] });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = {
      WORKOS_API_KEY: "sk_test",
      WORKOS_MCP_JWKS_URL: cacheJwksUrl,
      WORKOS_MCP_ISSUER: issuer,
    };
    await verifyMcpOAuthToken(fixture.token, env);
    await verifyMcpOAuthToken(fixture.token, env);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]) === cacheJwksUrl).length).toBe(1);
  });
});

async function tokenFixture(input: { scope: string; audience?: string }) {
  keyPairPromise ??= generateKeyPair("RS256");
  const { publicKey, privateKey } = await keyPairPromise;
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "mcp-key";
  publicJwk.alg = "RS256";
  const token = await new SignJWT({ scope: input.scope })
    .setProtectedHeader({ alg: "RS256", kid: "mcp-key" })
    .setIssuer(issuer)
    .setAudience(input.audience ?? MCP_RESOURCE_INDICATOR)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
    .sign(privateKey);
  return { token, publicJwk };
}

async function expiredFixture() {
  keyPairPromise ??= generateKeyPair("RS256");
  const { publicKey, privateKey } = await keyPairPromise;
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "mcp-key";
  publicJwk.alg = "RS256";
  const token = await new SignJWT({ scope: "read" })
    .setProtectedHeader({ alg: "RS256", kid: "mcp-key" })
    .setIssuer(issuer)
    .setAudience(MCP_RESOURCE_INDICATOR)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(privateKey);
  return { token, publicJwk };
}

function stubJwks(publicJwk: Awaited<ReturnType<typeof exportJWK>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url);
      if (href === jwksUrl) {
        return Response.json({ keys: [publicJwk] });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}
