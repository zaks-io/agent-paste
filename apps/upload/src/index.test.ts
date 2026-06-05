import { MCP_RESOURCE_INDICATOR, routeContracts } from "@agent-paste/contracts";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Env, handleRequest, mountedRouteIds, nonContractRoutePaths, type UploadSessionRecord } from "./index.js";

const mcpSubject = "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ";
const mcpJwksUrl = "https://tenant.authkit.app/oauth2/jwks";
const mcpIssuer = "https://tenant.authkit.app";
let mcpKeyPairPromise: ReturnType<typeof generateKeyPair> | undefined;

function createUploadRequestBody(
  files: Array<{ path: string; size_bytes: number }> = [{ path: "index.html", size_bytes: 12 }],
) {
  return { title: "Demo", entrypoint: "index.html", files };
}

describe("upload worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts every upload route contract", () => {
    expect([...mountedRouteIds].sort()).toEqual(
      routeContracts
        .filter((route) => route.app === "upload")
        .map((route) => route.id)
        .sort(),
    );
    expect([...nonContractRoutePaths]).toEqual(["/healthz", "/openapi.json"]);
  });

  it("GET /healthz returns 200 with no cookies", async () => {
    const response = await handleRequest(new Request("https://upload.test/healthz"), {});
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("serves a generated OpenAPI document", async () => {
    const response = await handleRequest(new Request("https://upload.test/openapi.json"), {});
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.toLowerCase()).toContain("application/json");
    const doc = (await response.json()) as {
      info: { title: string };
      paths: Record<
        string,
        Record<string, { responses: Record<string, { description?: string; headers?: Record<string, unknown> }> }>
      >;
    };

    expect(doc.info.title).toBe("Agent Paste Upload API");
    expect(doc.paths["/v1/upload-sessions"]?.post.responses["429"]).toMatchObject({
      description: expect.stringContaining("Actor or workspace rate limit"),
      headers: expect.any(Object),
    });
  });

  it("creates signed upload targets", async () => {
    const session: UploadSessionRecord = {
      session_id: "upl_1",
      workspace_id: "00000000-0000-4000-8000-000000000001",
      artifact_id: "art_1",
      revision_id: "rev_1",
      expires_at: "2030-01-01T00:00:00.000Z",
      files: [{ path: "index.html", size_bytes: 12 }],
    };
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["publish"] };
        },
      },
      DB: {
        async createUploadSession() {
          return session;
        },
        async getUploadSession() {
          return session;
        },
        async finalizeUploadSession() {
          return {};
        },
        async peekIdempotentReplay() {
          return null;
        },
      },
    };

    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions", {
        method: "POST",
        headers: { authorization: "Bearer ok", "idempotency-key": "idem", "content-type": "application/json" },
        body: JSON.stringify(createUploadRequestBody()),
      }),
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { files: Array<{ put_url: string }> };
    expect(body.files[0]?.put_url).toContain("/v1/upload-sessions/upl_1/files/index.html?token=");
  });

  it("returns 429 when the workspace rate limit fires", async () => {
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["publish"] };
        },
      },
      DB: {
        async createUploadSession() {
          throw new Error("rate limited requests should not create sessions");
        },
        async getUploadSession() {
          return null;
        },
        async finalizeUploadSession() {
          return {};
        },
        async peekIdempotentReplay() {
          return null;
        },
      },
      ACTOR_RATE_LIMIT: {
        async limit() {
          return { success: true };
        },
      },
      WORKSPACE_BURST_CAP: {
        async limit() {
          return { success: false };
        },
      },
    };

    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions", {
        method: "POST",
        headers: { authorization: "Bearer ok", "idempotency-key": "idem", "content-type": "application/json" },
        body: JSON.stringify(createUploadRequestBody()),
      }),
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("10");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "rate_limited_workspace" } });
  });

  it.each([
    [
      "create",
      "https://upload.test/v1/upload-sessions",
      {
        method: "POST",
        body: JSON.stringify(createUploadRequestBody()),
      },
    ],
    ["finalize", "https://upload.test/v1/upload-sessions/upl_1/finalize", { method: "POST" }],
  ])("requires publish scope for upload session %s", async (_label, url, init) => {
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["read"] };
        },
      },
      DB: {
        async createUploadSession() {
          throw new Error("create should not run without publish scope");
        },
        async getUploadSession() {
          throw new Error("finalize should not run without publish scope");
        },
        async finalizeUploadSession() {
          return {};
        },
        async peekIdempotentReplay() {
          return null;
        },
      },
    };

    const response = await handleRequest(
      new Request(url, {
        ...init,
        headers: { authorization: "Bearer ok", "idempotency-key": "idem", "content-type": "application/json" },
      }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it.each([
    ["api key", undefined] as const,
    ["MCP member", "write"] as const,
  ])("replays cached idempotent %s create before rate limits", async (_label, mcpScope) => {
    const mcpFixture = mcpScope ? await mcpTokenFixture({ scope: mcpScope }) : null;
    if (mcpFixture) {
      stubMcpFetch(mcpFixture.publicJwk);
    }
    const session: UploadSessionRecord = {
      session_id: "upl_replay",
      workspace_id: "00000000-0000-4000-8000-000000000001",
      artifact_id: "art_replay",
      revision_id: "rev_replay",
      expires_at: "2030-01-01T00:00:00.000Z",
      files: [{ path: "index.html", size_bytes: 12 }],
    };
    const memberActor = {
      type: "member" as const,
      id: "mem_replay",
      workspace_id: "00000000-0000-4000-8000-000000000001",
      email: "user@example.com",
      scopes: ["publish" as const],
    };
    const rateLimitCalls = { actor: 0, workspace: 0 };
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      ...(mcpScope
        ? {
            WORKOS_API_KEY: "sk_test_123",
            WORKOS_MCP_AUDIENCE: MCP_RESOURCE_INDICATOR,
            WORKOS_MCP_JWKS_URL: mcpJwksUrl,
            WORKOS_MCP_ISSUER: mcpIssuer,
          }
        : {}),
      AUTH: {
        async verifyApiKey(token) {
          if (token === "ok") {
            return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["publish"] };
          }
          return null;
        },
      },
      DB: {
        async createUploadSession() {
          throw new Error("replayed requests must not create new sessions");
        },
        async getUploadSession() {
          return null;
        },
        async finalizeUploadSession() {
          return {};
        },
        async getWebMemberByWorkOsUserId() {
          return memberActor;
        },
        async peekIdempotentReplay({ idempotencyKey, operation, actor }) {
          if (operation === "upload.session.create" && idempotencyKey === "replay") {
            expect(actor.type).toBe(mcpScope ? "member" : "api_key");
            return { result: session };
          }
          return null;
        },
      },
      ACTOR_RATE_LIMIT: {
        async limit() {
          rateLimitCalls.actor += 1;
          return { success: false };
        },
      },
      WORKSPACE_BURST_CAP: {
        async limit() {
          rateLimitCalls.workspace += 1;
          return { success: false };
        },
      },
    };

    const token = mcpFixture?.token ?? "ok";
    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": "replay",
          "content-type": "application/json",
        },
        body: JSON.stringify(createUploadRequestBody()),
      }),
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { upload_session_id: string; files: Array<{ put_url: string }> };
    expect(body.upload_session_id).toBe("upl_replay");
    expect(body.files[0]?.put_url).toContain("upl_replay");
    expect(rateLimitCalls).toEqual({ actor: 0, workspace: 0 });
  });

  it("replays cached idempotent finalize for MCP member before rate limits", async () => {
    const fixture = await mcpTokenFixture({ scope: "write" });
    stubMcpFetch(fixture.publicJwk);
    const finalized = {
      upload_session_id: "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      status: "draft" as const,
      title: "Demo",
      entrypoint: "index.html",
      file_count: 1,
      size_bytes: 12,
    };
    const memberActor = {
      type: "member" as const,
      id: "mem_replay",
      workspace_id: "00000000-0000-4000-8000-000000000001",
      email: "user@example.com",
      scopes: ["publish" as const],
    };
    const rateLimitCalls = { actor: 0, workspace: 0 };
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      WORKOS_API_KEY: "sk_test_123",
      WORKOS_MCP_AUDIENCE: MCP_RESOURCE_INDICATOR,
      WORKOS_MCP_JWKS_URL: mcpJwksUrl,
      WORKOS_MCP_ISSUER: mcpIssuer,
      DB: {
        async createUploadSession() {
          throw new Error("finalize replay must not create sessions");
        },
        async getUploadSession() {
          throw new Error("finalize replay must not load sessions");
        },
        async finalizeUploadSession() {
          throw new Error("replayed finalize must not run");
        },
        async getWebMemberByWorkOsUserId() {
          return memberActor;
        },
        async peekIdempotentReplay({ idempotencyKey, operation, actor }) {
          if (operation === "upload.session.finalize" && idempotencyKey === "replay-finalize") {
            expect(actor).toEqual(memberActor);
            return { result: finalized };
          }
          return null;
        },
      },
      ACTOR_RATE_LIMIT: {
        async limit() {
          rateLimitCalls.actor += 1;
          return { success: false };
        },
      },
      WORKSPACE_BURST_CAP: {
        async limit() {
          rateLimitCalls.workspace += 1;
          return { success: false };
        },
      },
    };

    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions/upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/finalize", {
        method: "POST",
        headers: {
          authorization: `Bearer ${fixture.token}`,
          "idempotency-key": "replay-finalize",
          "content-type": "application/json",
        },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject(finalized);
    expect(rateLimitCalls).toEqual({ actor: 0, workspace: 0 });
  });

  it("fails open when a rate limit binding errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const session: UploadSessionRecord = {
      session_id: "upl_1",
      workspace_id: "00000000-0000-4000-8000-000000000001",
      artifact_id: "art_1",
      revision_id: "rev_1",
      expires_at: "2030-01-01T00:00:00.000Z",
      files: [{ path: "index.html", size_bytes: 12 }],
    };
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["publish"] };
        },
      },
      DB: {
        async createUploadSession() {
          return session;
        },
        async getUploadSession() {
          return session;
        },
        async finalizeUploadSession() {
          return {};
        },
        async peekIdempotentReplay() {
          return null;
        },
      },
      WORKSPACE_BURST_CAP: {
        async limit() {
          throw new Error("binding unavailable");
        },
      },
    };

    try {
      const response = await handleRequest(
        new Request("https://upload.test/v1/upload-sessions", {
          method: "POST",
          headers: { authorization: "Bearer ok", "idempotency-key": "idem", "content-type": "application/json" },
          body: JSON.stringify(createUploadRequestBody()),
        }),
        env,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ upload_session_id: "upl_1" });
      expect(warn).toHaveBeenCalledWith("Rate limit workspace binding failed; allowing request.", expect.any(Error));
    } finally {
      warn.mockRestore();
    }
  });

  it("maps draft revision conflicts to 409", async () => {
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["publish"] };
        },
      },
      DB: {
        async createUploadSession() {
          throw new Error("draft_revision_conflict");
        },
        async peekIdempotentReplay() {
          return null;
        },
      },
    };

    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions", {
        method: "POST",
        headers: { authorization: "Bearer ok", "idempotency-key": "idem", "content-type": "application/json" },
        body: JSON.stringify(createUploadRequestBody()),
      }),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "draft_revision_conflict" } });
  });
});

describe("upload security headers", () => {
  function expectBaseline(response: Response): void {
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  }

  it("applies the baseline to /healthz", async () => {
    expectBaseline(await handleRequest(new Request("https://upload.test/healthz"), {}));
  });

  it("applies the baseline to a 404 response", async () => {
    expectBaseline(await handleRequest(new Request("https://upload.test/nope"), {}));
  });
});

async function mcpTokenFixture(input: { scope?: string } = {}) {
  mcpKeyPairPromise ??= generateKeyPair("RS256");
  const { publicKey, privateKey } = await mcpKeyPairPromise;
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "mcp-key";
  publicJwk.alg = "RS256";
  const token = await new SignJWT({ scope: input.scope ?? "read" })
    .setProtectedHeader({ alg: "RS256", kid: "mcp-key" })
    .setIssuer(mcpIssuer)
    .setAudience(MCP_RESOURCE_INDICATOR)
    .setSubject(mcpSubject)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
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
        return Response.json({ id: mcpSubject, email: "user@example.com" });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}
