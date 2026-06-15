import { MCP_RESOURCE_INDICATOR } from "@agent-paste/contracts";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTestMcpBearerAuth,
  createUnconfiguredMcpBearerAuth,
  createWorkOsMcpBearerAuth,
  parseBearerToken,
  rejectMissingBearer,
  rejectRejectedAuthKind,
} from "./auth.js";

const jwksUrl = "https://tenant.authkit.app/oauth2/jwks";
const issuer = "https://tenant.authkit.app";
let keyPairPromise: ReturnType<typeof generateKeyPair> | undefined;

describe("MCP bearer auth hooks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("parses bearer tokens case-insensitively", () => {
    expect(parseBearerToken("Bearer token-1")).toBe("token-1");
    expect(parseBearerToken("bearer token-2")).toBe("token-2");
    expect(parseBearerToken("Basic x")).toBeNull();
  });

  it("rejects API keys at the MCP surface", () => {
    const verify = createUnconfiguredMcpBearerAuth();
    expect(verify({ authorizationHeader: "Bearer ap_pk_live_test" })).toEqual(rejectRejectedAuthKind("api_key"));
  });

  it("rejects WorkOS session-style tokens at the MCP surface", () => {
    const verify = createTestMcpBearerAuth({
      ok: { tokenSub: "u1", bearerToken: "ok" },
    });
    const response = verify({ authorizationHeader: "Bearer wos_session_abc" });
    expect(response).toEqual({
      ok: false,
      code: "invalid_token",
      message: "workos_access_token is not accepted at the MCP surface",
    });
  });

  it("returns not-configured for opaque bearer tokens until JWT verification ships", () => {
    const verify = createUnconfiguredMcpBearerAuth();
    expect(verify({ authorizationHeader: "Bearer opaque-oauth-token" })).toEqual({
      ok: false,
      code: "invalid_token",
      message: "mcp_oauth_verifier_not_configured",
    });
    expect(verify({ authorizationHeader: null })).toEqual(rejectMissingBearer());
  });

  it("verifies OAuth tokens when WorkOS env is configured", async () => {
    const fixture = await oauthFixture();
    stubJwks(fixture.publicJwk);

    const verify = createWorkOsMcpBearerAuth({
      WORKOS_API_KEY: "sk_test",
      WORKOS_MCP_JWKS_URL: jwksUrl,
      WORKOS_MCP_ISSUER: issuer,
      WORKOS_MCP_AUDIENCE: MCP_RESOURCE_INDICATOR,
    });
    await expect(verify({ authorizationHeader: `Bearer ${fixture.token}` })).resolves.toEqual({
      ok: true,
      context: { tokenSub: "user_01", bearerToken: fixture.token },
    });
  });

  it("returns not-configured when WorkOS JWKS is missing", async () => {
    const verify = createWorkOsMcpBearerAuth({ WORKOS_API_KEY: "sk_test" });
    await expect(verify({ authorizationHeader: "Bearer opaque" })).resolves.toEqual({
      ok: false,
      code: "invalid_token",
      message: "mcp_oauth_verifier_not_configured",
    });
  });
});

async function oauthFixture() {
  keyPairPromise ??= generateKeyPair("RS256");
  const { publicKey, privateKey } = await keyPairPromise;
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "mcp-key";
  publicJwk.alg = "RS256";
  const token = await new SignJWT({ scope: "openid profile" })
    .setProtectedHeader({ alg: "RS256", kid: "mcp-key" })
    .setIssuer(issuer)
    .setAudience(MCP_RESOURCE_INDICATOR)
    .setSubject("user_01")
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
