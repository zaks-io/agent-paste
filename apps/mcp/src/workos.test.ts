import { MCP_RESOURCE_INDICATOR } from "@agent-paste/contracts";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { audienceFromPayload, verifyMcpOAuthToken } from "./workos.js";

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

    expect(verified).toEqual({ tokenSub: subject, scopes: ["write", "read"] });
  });

  it("rejects member-only scopes in the claim", async () => {
    const fixture = await tokenFixture({ scope: "read manage_workspace" });
    stubJwks(fixture.publicJwk);

    const verified = await verifyMcpOAuthToken(fixture.token, {
      WORKOS_API_KEY: "sk_test",
      WORKOS_MCP_JWKS_URL: jwksUrl,
      WORKOS_MCP_ISSUER: issuer,
    });
    expect(verified).toBeNull();
  });

  it("checks audience membership", () => {
    expect(audienceFromPayload({ aud: MCP_RESOURCE_INDICATOR }, MCP_RESOURCE_INDICATOR)).toBe(true);
    expect(audienceFromPayload({ aud: ["other", MCP_RESOURCE_INDICATOR] }, MCP_RESOURCE_INDICATOR)).toBe(true);
    expect(audienceFromPayload({ aud: "https://other.example" }, MCP_RESOURCE_INDICATOR)).toBe(false);
  });
});

async function tokenFixture(input: { scope: string }) {
  keyPairPromise ??= generateKeyPair("RS256");
  const { publicKey, privateKey } = await keyPairPromise;
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "mcp-key";
  publicJwk.alg = "RS256";
  const token = await new SignJWT({ scope: input.scope })
    .setProtectedHeader({ alg: "RS256", kid: "mcp-key" })
    .setIssuer(issuer)
    .setAudience(MCP_RESOURCE_INDICATOR)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
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
