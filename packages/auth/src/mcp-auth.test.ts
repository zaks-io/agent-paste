import { MCP_RESOURCE_INDICATOR } from "@agent-paste/contracts";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  audienceMatchesMcpResource,
  authenticateMcpBearer,
  type McpAuthEnv,
  type McpAuthenticatedPrincipal,
  mcpVerifyOptions,
  resolveMcpMemberActor,
} from "./mcp-auth.js";

const subject = "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ";
const mcpJwksUrl = "https://tenant.authkit.app/oauth2/jwks";
const mcpIssuer = "https://tenant.authkit.app";
let keyPairPromise: ReturnType<typeof generateKeyPair> | undefined;

function baseEnv(overrides: Partial<McpAuthEnv> = {}): McpAuthEnv {
  return {
    WORKOS_API_KEY: "sk_test_123",
    WORKOS_MCP_AUDIENCE: MCP_RESOURCE_INDICATOR,
    WORKOS_MCP_JWKS_URL: mcpJwksUrl,
    WORKOS_MCP_ISSUER: mcpIssuer,
    ...overrides,
  };
}

function request(url: string, token: string): Request {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

describe("MCP OAuth bearer verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts MCP resource aud when azp is a separate OAuth client id", async () => {
    const oauthClientId = "client_01MCPREGRESSIONAZP";
    const fixture = await mcpTokenFixture({ scope: "read", azp: oauthClientId });
    stubFetch(fixture.publicJwk);

    const principal = await authenticateMcpBearer(request("https://api.test/v1/mcp/whoami", fixture.token), baseEnv());
    expect(principal).toMatchObject({
      identity: { workos_user_id: subject, auth_surface: "mcp" },
      mcpScopes: ["read"],
    });
    expect(oauthClientId).not.toBe(MCP_RESOURCE_INDICATOR);
  });

  it("accepts MCP resource aud when client_id is a separate OAuth client id", async () => {
    const oauthClientId = "client_01MCPREGRESSIONCLIENTID";
    const fixture = await mcpTokenFixture({ scope: "read", client_id: oauthClientId });
    stubFetch(fixture.publicJwk);

    const principal = await authenticateMcpBearer(request("https://api.test/v1/mcp/whoami", fixture.token), baseEnv());
    expect(principal).toMatchObject({
      identity: { workos_user_id: subject, auth_surface: "mcp" },
      mcpScopes: ["read"],
    });
  });

  it("accepts a valid MCP resource token and maps scopes", async () => {
    const fixture = await mcpTokenFixture({ scope: "write read share" });
    stubFetch(fixture.publicJwk);

    const principal = await authenticateMcpBearer(
      request("https://upload.test/v1/upload-sessions", fixture.token),
      baseEnv(),
    );
    expect(principal).toMatchObject({
      identity: {
        workos_user_id: subject,
        email: "user@example.com",
        auth_surface: "mcp",
      },
      mcpScopes: ["write", "read", "share"],
      actor: {
        type: "member",
        scopes: ["publish", "read", "admin"],
      },
    });
  });

  it("rejects API keys at the MCP auth path", async () => {
    const principal = await authenticateMcpBearer(
      request("https://upload.test/v1/upload-sessions", "ap_pk_live_example"),
      baseEnv(),
    );
    expect(principal).toBeNull();
  });

  it("rejects tokens with the wrong audience", async () => {
    const fixture = await mcpTokenFixture({ audience: "https://other.example" });
    stubFetch(fixture.publicJwk);
    const principal = await authenticateMcpBearer(
      request("https://upload.test/v1/upload-sessions", fixture.token),
      baseEnv(),
    );
    expect(principal).toBeNull();
  });

  it("rejects tokens that include member-only scopes", async () => {
    const fixture = await mcpTokenFixture({ scope: "read manage_keys" });
    stubFetch(fixture.publicJwk);
    const principal = await authenticateMcpBearer(
      request("https://upload.test/v1/upload-sessions", fixture.token),
      baseEnv(),
    );
    expect(principal).toBeNull();
  });

  it("matches audience strings and arrays", () => {
    expect(audienceMatchesMcpResource(MCP_RESOURCE_INDICATOR, MCP_RESOURCE_INDICATOR)).toBe(true);
    expect(audienceMatchesMcpResource(["other", MCP_RESOURCE_INDICATOR], MCP_RESOURCE_INDICATOR)).toBe(true);
    expect(audienceMatchesMcpResource("https://other.example", MCP_RESOURCE_INDICATOR)).toBe(false);
    expect(audienceMatchesMcpResource([123], MCP_RESOURCE_INDICATOR)).toBe(false);
  });

  it("rejects missing bearer tokens and unconfigured verification", async () => {
    expect(await authenticateMcpBearer(new Request("https://upload.test/v1/upload-sessions"), baseEnv())).toBeNull();
    expect(mcpVerifyOptions({})).toBeNull();
    expect(mcpVerifyOptions({ WORKOS_API_KEY: "sk_test" })).toMatchObject({
      apiKey: "sk_test",
      clientId: MCP_RESOURCE_INDICATOR,
      skipClientIdClaimVerification: true,
    });
  });

  it("builds verify options from CLI fallbacks", () => {
    expect(
      mcpVerifyOptions({
        WORKOS_API_KEY: "sk_test",
        WORKOS_API_BASE_URL: "https://api.workos.com",
        WORKOS_CLI_ISSUER: mcpIssuer,
        WORKOS_CLI_JWKS_URL: mcpJwksUrl,
      }),
    ).toMatchObject({
      apiKey: "sk_test",
      apiBaseUrl: "https://api.workos.com",
      issuers: [mcpIssuer],
      jwksUrl: mcpJwksUrl,
    });
  });

  it("returns null when WorkOS user lookup fails", async () => {
    const fixture = await mcpTokenFixture({ scope: "read" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = url instanceof Request ? url.url : String(url);
        if (href === mcpJwksUrl) {
          return Response.json({ keys: [fixture.publicJwk] });
        }
        return new Response("not found", { status: 404 });
      }),
    );
    expect(
      await authenticateMcpBearer(request("https://upload.test/v1/upload-sessions", fixture.token), baseEnv()),
    ).toBeNull();
  });

  it("resolves member actors from the database", async () => {
    const principal: McpAuthenticatedPrincipal = {
      identity: { workos_user_id: subject, email: "user@example.com", auth_surface: "mcp" },
      mcpScopes: ["write", "read"],
      actor: {
        type: "member",
        id: "",
        workspace_id: "",
        email: "user@example.com",
        scopes: ["publish", "read"],
      },
    };
    const member = {
      type: "member" as const,
      id: "mem_01",
      workspace_id: "ws_01",
      email: "user@example.com",
      scopes: ["read"],
    };
    const resolved = await resolveMcpMemberActor(principal, {
      getWebMemberByWorkOsUserId: vi.fn(async () => member),
    });
    expect(resolved).toEqual({ ...member, scopes: ["publish", "read"] });
  });

  it("returns null when no web member exists", async () => {
    const principal: McpAuthenticatedPrincipal = {
      identity: { workos_user_id: subject, email: "user@example.com", auth_surface: "mcp" },
      mcpScopes: ["read"],
      actor: {
        type: "member",
        id: "",
        workspace_id: "",
        email: "user@example.com",
        scopes: ["read"],
      },
    };
    await expect(
      resolveMcpMemberActor(principal, { getWebMemberByWorkOsUserId: vi.fn(async () => null) }),
    ).resolves.toBeNull();
    await expect(
      resolveMcpMemberActor(principal, {
        getWebMemberByWorkOsUserId: vi.fn(async () => ({ type: "api_key" as const, id: "key", workspace_id: "ws" })),
      }),
    ).resolves.toBeNull();
  });
});

async function mcpTokenFixture(
  input: { scope?: string; audience?: string | string[]; azp?: string; client_id?: string } = {},
) {
  keyPairPromise ??= generateKeyPair("RS256");
  const { publicKey, privateKey } = await keyPairPromise;
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "mcp-key";
  publicJwk.alg = "RS256";
  const claims: Record<string, string> = { scope: input.scope ?? "read" };
  if (input.azp) {
    claims.azp = input.azp;
  }
  if (input.client_id) {
    claims.client_id = input.client_id;
  }
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "mcp-key" })
    .setIssuer(mcpIssuer)
    .setAudience(input.audience ?? MCP_RESOURCE_INDICATOR)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
    .sign(privateKey);
  return { token, publicJwk };
}

function stubFetch(publicJwk: JWK) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url);
      if (href === mcpJwksUrl) {
        return Response.json({ keys: [publicJwk] });
      }
      if (href.endsWith(`/user_management/users/${subject}`)) {
        return Response.json({ id: subject, email: "user@example.com" });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}
