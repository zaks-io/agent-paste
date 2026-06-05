import { MCP_RESOURCE_INDICATOR } from "@agent-paste/contracts";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Env, handleRequest, type UploadSessionRecord } from "./index.js";

const mcpSubject = "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ";
const mcpJwksUrl = "https://tenant.authkit.app/oauth2/jwks";
const mcpIssuer = "https://tenant.authkit.app";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const sessionId = "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
let mcpKeyPairPromise: ReturnType<typeof generateKeyPair> | undefined;

const memberActor = {
  type: "member" as const,
  id: "mem_mcp",
  workspace_id: workspaceId,
  email: "user@example.com",
  scopes: ["publish"] as const,
};

function createUploadRequestBody() {
  return { title: "Demo", entrypoint: "index.html", files: [{ path: "index.html", size_bytes: 12 }] };
}

function sessionRecord(): UploadSessionRecord {
  return {
    session_id: sessionId,
    workspace_id: workspaceId,
    artifact_id: artifactId,
    revision_id: revisionId,
    expires_at: "2030-01-01T00:00:00.000Z",
    files: [{ path: "index.html", size_bytes: 12 }],
  };
}

function mcpEnv(db: Env["DB"]): Env {
  return {
    UPLOAD_SIGNING_SECRET: "secret",
    WORKOS_API_KEY: "sk_test_123",
    WORKOS_MCP_AUDIENCE: MCP_RESOURCE_INDICATOR,
    WORKOS_MCP_JWKS_URL: mcpJwksUrl,
    WORKOS_MCP_ISSUER: mcpIssuer,
    AUTH: {
      async verifyApiKey() {
        return null;
      },
    },
    DB: db,
  };
}

function memberDb(overrides: Partial<NonNullable<Env["DB"]>> = {}): NonNullable<Env["DB"]> {
  return {
    async getWebMemberByWorkOsUserId({ workosUserId }) {
      return workosUserId === mcpSubject ? memberActor : null;
    },
    async createUploadSession() {
      throw new Error("createUploadSession should not run");
    },
    async getUploadSession() {
      throw new Error("getUploadSession should not run");
    },
    async finalizeUploadSession() {
      throw new Error("finalizeUploadSession should not run");
    },
    async peekIdempotentReplay() {
      return null;
    },
    ...overrides,
  } as NonNullable<Env["DB"]>;
}

describe("Upload MCP route-boundary auth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("uploadSessions.create", () => {
    it("accepts a signed MCP member token at the route boundary", async () => {
      const fixture = await mcpTokenFixture({ scope: "write" });
      stubMcpFetch(fixture.publicJwk);
      const session = sessionRecord();
      let createCalled = false;

      const response = await handleRequest(
        new Request("https://upload.test/v1/upload-sessions", {
          method: "POST",
          headers: {
            authorization: `Bearer ${fixture.token}`,
            "idempotency-key": "idem-create",
            "content-type": "application/json",
          },
          body: JSON.stringify(createUploadRequestBody()),
        }),
        mcpEnv(
          memberDb({
            async createUploadSession({ actor }) {
              createCalled = true;
              expect(actor).toEqual(memberActor);
              return session;
            },
          }),
        ),
      );

      expect(response.status).toBe(200);
      expect(createCalled).toBe(true);
      await expect(response.json()).resolves.toMatchObject({ upload_session_id: sessionId });
    });

    it("still accepts API keys on api_key_or_mcp_oauth create", async () => {
      const session = sessionRecord();
      const response = await handleRequest(
        new Request("https://upload.test/v1/upload-sessions", {
          method: "POST",
          headers: {
            authorization: "Bearer ok",
            "idempotency-key": "idem-api-key",
            "content-type": "application/json",
          },
          body: JSON.stringify(createUploadRequestBody()),
        }),
        {
          UPLOAD_SIGNING_SECRET: "secret",
          AUTH: {
            async verifyApiKey(token) {
              return token === "ok"
                ? { type: "api_key", id: "key_1", workspace_id: workspaceId, scopes: ["publish"] }
                : null;
            },
          },
          DB: {
            async createUploadSession({ actor }) {
              expect(actor).toMatchObject({ type: "api_key", id: "key_1" });
              return session;
            },
            async peekIdempotentReplay() {
              return null;
            },
          },
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ upload_session_id: sessionId });
    });

    it("rejects MCP tokens with the wrong audience", async () => {
      const fixture = await mcpTokenFixture({ audience: "https://other.example" });
      stubMcpFetch(fixture.publicJwk);

      const response = await handleRequest(
        new Request("https://upload.test/v1/upload-sessions", {
          method: "POST",
          headers: {
            authorization: `Bearer ${fixture.token}`,
            "idempotency-key": "idem-bad-aud",
            "content-type": "application/json",
          },
          body: JSON.stringify(createUploadRequestBody()),
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
        new Request("https://upload.test/v1/upload-sessions", {
          method: "POST",
          headers: {
            authorization: `Bearer ${fixture.token}`,
            "idempotency-key": "idem-expired",
            "content-type": "application/json",
          },
          body: JSON.stringify(createUploadRequestBody()),
        }),
        mcpEnv(memberDb()),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
    });

    it("forbids signed MCP tokens when no workspace member exists", async () => {
      const fixture = await mcpTokenFixture({ scope: "write" });
      stubMcpFetch(fixture.publicJwk);

      const response = await handleRequest(
        new Request("https://upload.test/v1/upload-sessions", {
          method: "POST",
          headers: {
            authorization: `Bearer ${fixture.token}`,
            "idempotency-key": "idem-forbidden",
            "content-type": "application/json",
          },
          body: JSON.stringify(createUploadRequestBody()),
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

  describe("uploadSessions.finalize", () => {
    it("accepts a signed MCP member token at the route boundary", async () => {
      const fixture = await mcpTokenFixture({ scope: "write" });
      stubMcpFetch(fixture.publicJwk);
      const finalized = {
        upload_session_id: sessionId,
        artifact_id: artifactId,
        revision_id: revisionId,
        status: "draft" as const,
        title: "Demo",
        entrypoint: "index.html",
        file_count: 1,
        size_bytes: 12,
      };

      const response = await handleRequest(
        new Request(`https://upload.test/v1/upload-sessions/${sessionId}/finalize`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${fixture.token}`,
            "idempotency-key": "idem-finalize",
            "content-type": "application/json",
          },
        }),
        mcpEnv(
          memberDb({
            async peekIdempotentReplay({ idempotencyKey, operation, actor }) {
              if (operation === "upload.session.finalize" && idempotencyKey === "idem-finalize") {
                expect(actor).toEqual(memberActor);
                return { result: finalized };
              }
              return null;
            },
          }),
        ),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject(finalized);
    });

    it("still accepts API keys on api_key_or_mcp_oauth finalize", async () => {
      const finalized = {
        upload_session_id: sessionId,
        artifact_id: artifactId,
        revision_id: revisionId,
        status: "draft" as const,
        title: "Demo",
        entrypoint: "index.html",
        file_count: 1,
        size_bytes: 12,
      };

      const response = await handleRequest(
        new Request(`https://upload.test/v1/upload-sessions/${sessionId}/finalize`, {
          method: "POST",
          headers: {
            authorization: "Bearer ok",
            "idempotency-key": "idem-api-finalize",
            "content-type": "application/json",
          },
        }),
        {
          UPLOAD_SIGNING_SECRET: "secret",
          AUTH: {
            async verifyApiKey(token) {
              return token === "ok"
                ? { type: "api_key", id: "key_1", workspace_id: workspaceId, scopes: ["publish"] }
                : null;
            },
          },
          DB: {
            async createUploadSession() {
              throw new Error("createUploadSession should not run in finalize auth tests");
            },
            async peekIdempotentReplay({ idempotencyKey, operation, actor }) {
              if (operation === "upload.session.finalize" && idempotencyKey === "idem-api-finalize") {
                expect(actor).toMatchObject({ type: "api_key", id: "key_1" });
                return { result: finalized };
              }
              return null;
            },
          },
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject(finalized);
    });

    it("rejects MCP tokens with the wrong audience", async () => {
      const fixture = await mcpTokenFixture({ audience: "https://other.example" });
      stubMcpFetch(fixture.publicJwk);

      const response = await handleRequest(
        new Request(`https://upload.test/v1/upload-sessions/${sessionId}/finalize`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${fixture.token}`,
            "idempotency-key": "idem-bad-aud-finalize",
            "content-type": "application/json",
          },
        }),
        mcpEnv(memberDb()),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
    });

    it("forbids signed MCP tokens when no workspace member exists", async () => {
      const fixture = await mcpTokenFixture({ scope: "write" });
      stubMcpFetch(fixture.publicJwk);

      const response = await handleRequest(
        new Request(`https://upload.test/v1/upload-sessions/${sessionId}/finalize`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${fixture.token}`,
            "idempotency-key": "idem-forbidden-finalize",
            "content-type": "application/json",
          },
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
