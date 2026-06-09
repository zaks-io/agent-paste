import { MCP_RESOURCE_INDICATOR } from "@agent-paste/contracts";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Env, handleRequest } from "./index.js";

const mcpSubject = "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ";
const mcpJwksUrl = "https://tenant.authkit.app/oauth2/jwks";
const mcpIssuer = "https://tenant.authkit.app";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
let mcpKeyPairPromise: ReturnType<typeof generateKeyPair> | undefined;

const memberActor = {
  type: "member" as const,
  id: "mem_mcp",
  workspace_id: workspaceId,
  email: "user@example.com",
  scopes: ["read", "publish", "admin"] as const,
};

function allowRateLimits(): Pick<Env, "ACTOR_RATE_LIMIT" | "WORKSPACE_BURST_CAP"> {
  return {
    ACTOR_RATE_LIMIT: { limit: async () => ({ success: true }) },
    WORKSPACE_BURST_CAP: { limit: async () => ({ success: true }) },
  };
}

function mcpEnv(db: Env["DB"]): Env {
  return {
    ...allowRateLimits(),
    WORKOS_API_KEY: "sk_test_123",
    WORKOS_MCP_AUDIENCE: MCP_RESOURCE_INDICATOR,
    WORKOS_MCP_JWKS_URL: mcpJwksUrl,
    WORKOS_MCP_ISSUER: mcpIssuer,
    DB: db,
  };
}

function memberDb(overrides: Partial<NonNullable<Env["DB"]>> = {}): NonNullable<Env["DB"]> {
  return {
    async getWhoami() {
      throw new Error("getWhoami should not run in MCP route auth tests");
    },
    async getWebMemberByWorkOsUserId({ workosUserId }) {
      return workosUserId === mcpSubject ? memberActor : null;
    },
    async getWebWorkspace(actor) {
      expect(actor).toEqual(memberActor);
      return { workspace: { id: workspaceId, name: "MCP Workspace" } };
    },
    ...overrides,
  } as NonNullable<Env["DB"]>;
}

describe("API MCP route-boundary auth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("mcp.whoami", () => {
    it("accepts a signed MCP member token at the route boundary", async () => {
      const fixture = await mcpTokenFixture({ scope: "read" });
      stubMcpFetch(fixture.publicJwk);

      const response = await handleRequest(
        new Request("https://api.test/v1/mcp/whoami", {
          headers: { authorization: `Bearer ${fixture.token}` },
        }),
        mcpEnv(memberDb()),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        workspace_member: { id: memberActor.id, email: memberActor.email },
        workspace: { id: workspaceId, name: "MCP Workspace" },
        scopes: ["write", "read", "share"],
      });
    });

    it("rejects MCP tokens with the wrong audience", async () => {
      const fixture = await mcpTokenFixture({ audience: "https://other.example" });
      stubMcpFetch(fixture.publicJwk);

      const response = await handleRequest(
        new Request("https://api.test/v1/mcp/whoami", {
          headers: { authorization: `Bearer ${fixture.token}` },
        }),
        mcpEnv(memberDb()),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
    });

    it("rejects expired MCP tokens", async () => {
      const fixture = await mcpTokenFixture({ expiresInSeconds: -60 });
      stubMcpFetch(fixture.publicJwk);

      const response = await handleRequest(
        new Request("https://api.test/v1/mcp/whoami", {
          headers: { authorization: `Bearer ${fixture.token}` },
        }),
        mcpEnv(memberDb()),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
    });

    it("returns a retryable error when WorkOS JWKS verification is unavailable", async () => {
      const unavailableJwksUrl = "https://tenant.authkit.app/oauth2/jwks-unavailable";
      const fixture = await mcpTokenFixture({ scope: "read" });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL | Request) => {
          const href = url instanceof Request ? url.url : String(url);
          if (href === unavailableJwksUrl) {
            return new Response("bad gateway", { status: 502 });
          }
          return new Response("not found", { status: 404 });
        }),
      );

      const response = await handleRequest(
        new Request("https://api.test/v1/mcp/whoami", {
          headers: { authorization: `Bearer ${fixture.token}` },
        }),
        {
          ...mcpEnv(memberDb()),
          WORKOS_MCP_JWKS_URL: unavailableJwksUrl,
        },
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "database_unavailable" } });
    });

    it("rejects malformed bearer tokens", async () => {
      const response = await handleRequest(
        new Request("https://api.test/v1/mcp/whoami", {
          headers: { authorization: "Bearer not-a-jwt" },
        }),
        mcpEnv(memberDb()),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
    });

    it("rejects API keys on the MCP-only route", async () => {
      const response = await handleRequest(
        new Request("https://api.test/v1/mcp/whoami", {
          headers: { authorization: "Bearer ap_pk_live_example" },
        }),
        {
          ...allowRateLimits(),
          AUTH: {
            async verifyApiKey() {
              return { type: "api_key", id: "key_1", workspace_id: workspaceId, scopes: ["read"] };
            },
          },
          DB: memberDb(),
        },
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
    });

    it("forbids signed MCP tokens when no workspace member exists", async () => {
      const fixture = await mcpTokenFixture({ scope: "read" });
      stubMcpFetch(fixture.publicJwk);

      const response = await handleRequest(
        new Request("https://api.test/v1/mcp/whoami", {
          headers: { authorization: `Bearer ${fixture.token}` },
        }),
        mcpEnv(
          memberDb({
            async getWebMemberByWorkOsUserId() {
              return null;
            },
          }),
        ),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
    });
  });

  describe("api_key_or_mcp_oauth parity on revisions.list", () => {
    const revisionsListUrl = `https://api.test/v1/artifacts/${artifactId}/revisions`;

    function revisionsDb(): NonNullable<Env["DB"]> {
      return {
        async getWhoami() {
          throw new Error("getWhoami should not run in revisions auth tests");
        },
        async listRevisions({ actor, artifactId: listedArtifactId }) {
          expect(actor.type).toBeDefined();
          expect(listedArtifactId).toBe(artifactId);
          return {
            artifact_id: artifactId,
            items: [],
            page_info: { next_cursor: null, has_more: false },
          };
        },
      } as NonNullable<Env["DB"]>;
    }

    it("still accepts API keys on api_key_or_mcp_oauth routes", async () => {
      const response = await handleRequest(new Request(revisionsListUrl, { headers: { authorization: "Bearer ok" } }), {
        ...allowRateLimits(),
        AUTH: {
          async verifyApiKey(token) {
            return token === "ok"
              ? { type: "api_key", id: "key_1", workspace_id: workspaceId, scopes: ["read"] }
              : null;
          },
        },
        DB: revisionsDb(),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ artifact_id: artifactId, items: [] });
    });

    it("accepts signed MCP member tokens on api_key_or_mcp_oauth routes", async () => {
      const fixture = await mcpTokenFixture({ scope: "read" });
      stubMcpFetch(fixture.publicJwk);

      const response = await handleRequest(
        new Request(revisionsListUrl, { headers: { authorization: `Bearer ${fixture.token}` } }),
        mcpEnv({
          ...revisionsDb(),
          async getWebMemberByWorkOsUserId({ workosUserId }) {
            return workosUserId === mcpSubject ? memberActor : null;
          },
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ artifact_id: artifactId, items: [] });
    });

    it("rejects MCP tokens with the wrong audience on api_key_or_mcp_oauth routes", async () => {
      const fixture = await mcpTokenFixture({ audience: "https://other.example" });
      stubMcpFetch(fixture.publicJwk);

      const response = await handleRequest(
        new Request(revisionsListUrl, { headers: { authorization: `Bearer ${fixture.token}` } }),
        mcpEnv({
          ...revisionsDb(),
          async getWebMemberByWorkOsUserId() {
            throw new Error("member lookup must not run for bad audience");
          },
        }),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
    });

    it("forbids signed MCP tokens without workspace membership on api_key_or_mcp_oauth routes", async () => {
      const fixture = await mcpTokenFixture({ scope: "read" });
      stubMcpFetch(fixture.publicJwk);

      const response = await handleRequest(
        new Request(revisionsListUrl, { headers: { authorization: `Bearer ${fixture.token}` } }),
        mcpEnv({
          ...revisionsDb(),
          async getWebMemberByWorkOsUserId() {
            return null;
          },
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
    });
  });
});

async function mcpTokenFixture(
  input: { scope?: string; audience?: string | string[]; expiresInSeconds?: number } = {},
) {
  mcpKeyPairPromise ??= generateKeyPair("RS256");
  const { publicKey, privateKey } = await mcpKeyPairPromise;
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "mcp-key";
  publicJwk.alg = "RS256";
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ scope: input.scope ?? "read" })
    .setProtectedHeader({ alg: "RS256", kid: "mcp-key" })
    .setIssuer(mcpIssuer)
    .setAudience(input.audience ?? MCP_RESOURCE_INDICATOR)
    .setSubject(mcpSubject)
    .setIssuedAt(now + (input.expiresInSeconds ?? 0))
    .setExpirationTime(now + (input.expiresInSeconds ?? 300))
    .sign(privateKey);
  return { token, publicJwk };
}

function stubMcpFetch(publicJwk: JWK) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url);
      if (href === mcpJwksUrl) {
        return Response.json({ keys: [publicJwk] });
      }
      if (href.endsWith(`/user_management/users/${mcpSubject}`)) {
        return Response.json({ id: mcpSubject, email: memberActor.email });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}
