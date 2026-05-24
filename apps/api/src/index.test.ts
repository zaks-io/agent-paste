import { routeContracts } from "@agent-paste/contracts";
import { mintAgentViewToken } from "@agent-paste/tokens/agent-view";
import { describe, expect, it, vi } from "vitest";
import { type ApiDatabase, type Env, handleRequest, mountedRouteIds, nonContractRoutePaths } from "./index.js";

describe("api worker", () => {
  it("mounts every api and admin route contract", () => {
    expect([...mountedRouteIds].sort()).toEqual(
      routeContracts
        .filter((route) => route.app === "api" || route.app === "admin")
        .map((route) => route.id)
        .sort(),
    );
    expect([...nonContractRoutePaths]).toEqual([
      "/openapi.json",
      "/admin/whoami",
      "/__test__/force-expire",
      "/__test__/r2-list",
      "/__test__/denylist",
    ]);
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
              default_ttl_seconds: 30 * 24 * 60 * 60,
              min_ttl_seconds: 24 * 60 * 60,
              max_ttl_seconds: 90 * 24 * 60 * 60,
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
          return {
            api_key: {
              id: "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
              workspace_id: input.actor.workspace_id,
              name: input.name,
              public_id: "01HZY7Q8X9Y2S3T4",
              scopes: ["publish", "read"],
              revoked_at: null,
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
          throw new Error("api_key_not_found");
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
            autoDeletionDays: 14,
          });
          return {
            workspace_name: input.workspaceName,
            auto_deletion_days: input.autoDeletionDays,
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
        body: JSON.stringify({ workspace_name: "Renamed Workspace", auto_deletion_days: 14 }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workspace_name: "Renamed Workspace",
      auto_deletion_days: 14,
    });
  });

  it.each([
    ["below the minimum", { workspace_name: "ok", auto_deletion_days: 0 }],
    ["above the maximum", { workspace_name: "ok", auto_deletion_days: 91 }],
    ["a non-integer", { workspace_name: "ok", auto_deletion_days: 1.5 }],
    ["a blank name", { workspace_name: "", auto_deletion_days: 30 }],
    ["a too-long name", { workspace_name: "x".repeat(121), auto_deletion_days: 30 }],
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
        body: JSON.stringify({ workspace_name: "ok", auto_deletion_days: 30 }),
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
        body: JSON.stringify({ workspace_name: "ok", auto_deletion_days: 30 }),
      }),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it("fails open when a rate limit binding errors", async () => {
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

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ actor: { id: "key_1" } });
      expect(warn).toHaveBeenCalledWith("Rate limit actor binding failed; allowing request.", expect.any(Error));
    } finally {
      warn.mockRestore();
    }
  });

  it("runs admin cleanup with the configured admin token", async () => {
    const env: Env = {
      ADMIN_TOKEN: "admin",
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
        async runCleanup(input) {
          return { dry_run: input.dryRun };
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/admin/cleanup/run", {
        method: "POST",
        headers: {
          authorization: "Bearer admin",
          "content-type": "application/json",
          "idempotency-key": "cleanup-1",
        },
        body: JSON.stringify({ dry_run: true }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ dry_run: true });
  });

  it("writes the ADR 0057 artifact denylist key when an admin deletes an artifact", async () => {
    const puts: Array<{ key: string; value: string; expirationTtl?: number }> = [];
    const env: Env = {
      ADMIN_TOKEN: "admin",
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
        async deleteArtifact() {
          return {
            artifact_id: "art_1",
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
      new Request("https://api.test/admin/artifacts/art_1", {
        method: "DELETE",
        headers: { authorization: "Bearer admin", "idempotency-key": "delete-1" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ artifact_id: "art_1", deleted_r2_objects: 0 });
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ key: "ad:art_1", expirationTtl: 90 * 24 * 60 * 60 });
    expect(JSON.parse(puts[0]?.value ?? "{}")).toMatchObject({ reason: "deletion", at: expect.any(String) });
  });

  it("writes ADR 0057 artifact denylist keys for expired cleanup artifacts", async () => {
    const puts: Array<{ key: string; value: string; expirationTtl?: number }> = [];
    const env: Env = {
      ADMIN_TOKEN: "admin",
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
        async runCleanup(input) {
          return input.dryRun ? { expired_artifact_ids: [] } : { expired_artifact_ids: ["art_1", "art_2"] };
        },
      },
      DENYLIST: {
        async put(key, value, options) {
          puts.push({ key, value, expirationTtl: options?.expirationTtl });
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/admin/cleanup/run", {
        method: "POST",
        headers: {
          authorization: "Bearer admin",
          "content-type": "application/json",
          "idempotency-key": "cleanup-2",
        },
        body: JSON.stringify({ dry_run: false }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      expired_artifact_ids: ["art_1", "art_2"],
      deleted_r2_objects: 0,
    });
    expect(puts).toHaveLength(2);
    expect(puts.map((put) => ({ key: put.key, expirationTtl: put.expirationTtl }))).toEqual([
      { key: "ad:art_1", expirationTtl: 90 * 24 * 60 * 60 },
      { key: "ad:art_2", expirationTtl: 90 * 24 * 60 * 60 },
    ]);
    expect(puts.map((put) => JSON.parse(put.value))).toEqual([
      { reason: "deletion", at: expect.any(String) },
      { reason: "deletion", at: expect.any(String) },
    ]);
  });

  it("does not write denylist keys during dry-run cleanup", async () => {
    const puts: Array<{ key: string; value: string; expirationTtl?: number }> = [];
    const env: Env = {
      ADMIN_TOKEN: "admin",
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
        async runCleanup(input) {
          return input.dryRun ? { expired_artifact_ids: [] } : { expired_artifact_ids: ["art_1", "art_2"] };
        },
      },
      DENYLIST: {
        async put(key, value, options) {
          puts.push({ key, value, expirationTtl: options?.expirationTtl });
        },
      },
    };

    const response = await handleRequest(
      new Request("https://api.test/admin/cleanup/run", {
        method: "POST",
        headers: {
          authorization: "Bearer admin",
          "content-type": "application/json",
          "idempotency-key": "cleanup-dry-run",
        },
        body: JSON.stringify({ dry_run: true }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ expired_artifact_ids: [] });
    expect(puts).toHaveLength(0);
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
            view_url: "https://content.test/v/token/index.html",
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
    await expect(response.text()).resolves.toContain("Browser Proof");
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

  it("sets a lockdown for a WorkOS operator and writes the denylist key", async () => {
    const puts: Array<{ key: string; value: string; expirationTtl?: number }> = [];
    const env: Env = {
      OPERATOR_EMAILS: "user@example.com",
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
    expect(puts[0]).toMatchObject({ key: "wsd:w_123", expirationTtl: 90 * 24 * 60 * 60 });
    expect(JSON.parse(puts[0]?.value ?? "{}")).toMatchObject({
      reason: "platform_lockdown_workspace",
      at: expect.any(String),
    });
  });

  it("lifts a lockdown and deletes the denylist key", async () => {
    const deletes: string[] = [];
    const env: Env = {
      OPERATOR_EMAILS: "user@example.com",
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
      OPERATOR_EMAILS: "user@example.com",
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
      OPERATOR_EMAILS: "user@example.com",
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

  it("returns 404 for a WorkOS session whose email is not an operator", async () => {
    const env: Env = {
      OPERATOR_EMAILS: "ops@example.com",
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async setLockdown() {
          throw new Error("setLockdown must not run for non-operators");
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
      OPERATOR_EMAILS: "user@example.com",
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
      OPERATOR_EMAILS: "user@example.com",
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
      OPERATOR_EMAILS: "user@example.com",
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

  it("paginates effective lockdowns and excludes lifted ones via the repository", async () => {
    const lockdowns = [
      lockdownDetail({ scope: "workspace", target_id: "w_3", set_at: "2026-01-03T00:00:00.000Z" }),
      lockdownDetail({ scope: "workspace", target_id: "w_2", set_at: "2026-01-02T00:00:00.000Z" }),
    ];
    const env: Env = {
      OPERATOR_EMAILS: "user@example.com",
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
      OPERATOR_EMAILS: "user@example.com",
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
      OPERATOR_EMAILS: "user@example.com",
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

  it("returns 404 listing lockdowns for a WorkOS session whose email is not an operator", async () => {
    const env: Env = {
      OPERATOR_EMAILS: "ops@example.com",
      AUTH: webAuthForTests(),
      DB: operatorDbForTests({
        async listLockdowns() {
          throw new Error("listLockdowns must not run for non-operators");
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
      OPERATOR_EMAILS: "user@example.com",
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
      OPERATOR_EMAILS: "user@example.com",
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
      OPERATOR_EMAILS: "user@example.com",
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
});

function webAuthForTests(): Env["AUTH"] {
  return {
    async verifyApiKey() {
      return null;
    },
    async verifyWebToken(token) {
      return token === "workos-ok" ? { workos_user_id: "user_1", email: "user@example.com", token_id: "jti_1" } : null;
    },
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
    async getWebMemberByWorkOsUserId() {
      return {
        type: "member",
        id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ",
        workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
        scopes,
      };
    },
    ...overrides,
  };
}
