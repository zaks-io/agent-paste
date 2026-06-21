import { requestIdMiddleware } from "@agent-paste/auth";
import { IdempotencyInFlightError } from "@agent-paste/commands";
import { ErrorCode, type RouteContract } from "@agent-paste/contracts";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setContractErrorEnforcement } from "./contract-errors.js";
import { ERROR_STATUS } from "./errors.js";
import { createRegistrar } from "./registrar.js";

const baseContract: RouteContract = {
  id: "test.route",
  app: "api",
  method: "GET",
  path: "/test",
  auth: "api_key",
  scopes: [],
  idempotency: "none",
  rateLimit: "none",
  responseSchema: "EmptyObject",
  errors: [
    "not_authenticated",
    "invalid_auth",
    "database_unavailable",
    "rate_limited_actor",
    "rate_limited_workspace",
    "forbidden",
    "invalid_request",
    "invalid_idempotency_key",
    "idempotency_in_flight",
    "not_found",
    "rate_limited_artifact",
  ],
};

describe("contract-driven registrar", () => {
  beforeEach(() => {
    setContractErrorEnforcement(true);
  });

  afterEach(() => {
    setContractErrorEnforcement(undefined);
  });

  it("maps every contract error code to a status", () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ErrorCode.options].sort());
    expect(ERROR_STATUS.file_size_cap_exceeded).toBe(400);
    expect(ERROR_STATUS.upload_session_expired).toBe(409);
    expect(ERROR_STATUS.rate_limited_artifact).toBe(429);
  });

  it("returns an envelope for missing or invalid auth", async () => {
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async api_key() {
          return { ok: false, code: "not_authenticated" };
        },
      },
    }).mount(baseContract, async () => jsonOk({ ok: true }));

    const response = await app.fetch(
      new Request("https://worker.test/test", { headers: { "x-request-id": "req-12345678" } }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBe("req-12345678");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
  });

  it("allows signed-token resolvers to collapse auth failures to not_found", async () => {
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async signed_content_token() {
          return { ok: false, code: "not_found" };
        },
      },
    }).mount({ ...baseContract, auth: "signed_content_token", path: "/v/{token}/{path}" }, async () =>
      jsonOk({ ok: true }),
    );

    const response = await app.fetch(new Request("https://worker.test/v/bad/index.html"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("routes nested file paths through trailing {path} contract params", async () => {
    const seen: Array<{ pathname: string; sessionId: string | undefined }> = [];
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async signed_upload_url() {
          return { ok: true, principal: { kind: "signed_upload_url", payload: {} } };
        },
      },
    }).mount(
      {
        ...baseContract,
        method: "PUT",
        auth: "signed_upload_url",
        path: "/v1/upload-sessions/{upload_session_id}/files/{path}",
      },
      async (context) => {
        seen.push({
          pathname: new URL(context.req.raw.url).pathname,
          sessionId: context.req.param("upload_session_id"),
        });
        return jsonOk({ ok: true });
      },
    );

    const nested = await app.fetch(
      new Request("https://worker.test/v1/upload-sessions/upl_1/files/assets/app.js", { method: "PUT" }),
    );
    const flat = await app.fetch(
      new Request("https://worker.test/v1/upload-sessions/upl_1/files/index.html", { method: "PUT" }),
    );

    expect(nested.status).toBe(200);
    expect(flat.status).toBe(200);
    expect(seen).toEqual([
      { pathname: "/v1/upload-sessions/upl_1/files/assets/app.js", sessionId: "upl_1" },
      { pathname: "/v1/upload-sessions/upl_1/files/index.html", sessionId: "upl_1" },
    ]);
  });

  it("returns actor and workspace rate-limit errors with retry headers", async () => {
    const actorLimited = await rateLimitedResponse({ actor: { success: false } });
    expect(actorLimited.status).toBe(429);
    expect(actorLimited.headers.get("retry-after")).toBe("60");
    await expect(actorLimited.json()).resolves.toMatchObject({ error: { code: "rate_limited_actor" } });

    const workspaceLimited = await rateLimitedResponse({ actor: { success: true }, workspace: { success: false } });
    expect(workspaceLimited.status).toBe(429);
    expect(workspaceLimited.headers.get("retry-after")).toBe("10");
    await expect(workspaceLimited.json()).resolves.toMatchObject({ error: { code: "rate_limited_workspace" } });
  });

  it("returns artifact rate-limit errors with retry headers", async () => {
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async signed_content_token() {
          return {
            ok: true,
            principal: { kind: "signed_content_token", payload: { artifact_id: "art_1" } },
          };
        },
      },
      rateLimitBindings: () => ({
        artifact: {
          async limit() {
            return { success: false };
          },
        },
      }),
    }).mount(
      { ...baseContract, auth: "signed_content_token", path: "/v/{token}/{path}", rateLimit: "artifact" },
      async () => jsonOk({ ok: true }),
    );

    const response = await app.fetch(new Request("https://worker.test/v/token/index.html"));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "rate_limited_artifact" } });
  });

  it("fails closed when rate-limit bindings are missing or throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const missing = await rateLimitedResponse({});
      expect(missing.status).toBe(429);
      await expect(missing.json()).resolves.toMatchObject({ error: { code: "rate_limited_actor" } });

      const throwing = await rateLimitedResponse({
        actor: new Error("binding unavailable"),
        workspace: { success: true },
      });
      expect(throwing.status).toBe(429);
      await expect(throwing.json()).resolves.toMatchObject({ error: { code: "rate_limited_actor" } });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("throws at mount when a rate-limited route has no rate-limit bindings provider", () => {
    const app = newApp();
    const registrar = createRegistrar({
      app,
      auth: {
        async api_key() {
          return principal(["read"]);
        },
      },
    });
    expect(() => registrar.mount({ ...baseContract, rateLimit: "actor" }, async () => jsonOk({ ok: true }))).toThrow(
      /requires the 'actor' rate limit, but this registrar has no rateLimitBindings provider/,
    );
  });

  it("allows mounting a rateLimit:none route on a registrar with no rate-limit bindings", () => {
    const app = newApp();
    const registrar = createRegistrar({
      app,
      auth: {
        async api_key() {
          return principal(["read"]);
        },
      },
    });
    expect(() => registrar.mount(baseContract, async () => jsonOk({ ok: true }))).not.toThrow();
  });

  it("validates required idempotency keys before running the handler", async () => {
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async api_key() {
          return principal();
        },
      },
    }).mount({ ...baseContract, method: "POST", idempotency: "required" }, async () => jsonOk({ ok: true }));

    const response = await app.fetch(new Request("https://worker.test/test", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_idempotency_key" } });
  });

  it("rejects whitespace-only idempotency keys and normalizes accepted keys", async () => {
    const seenKeys: string[] = [];
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async api_key() {
          return principal();
        },
      },
    }).mount({ ...baseContract, method: "POST", idempotency: "required" }, async (_context, _principal, guard) => {
      const key: string = guard.idempotencyKey;
      seenKeys.push(key);
      return jsonOk({ ok: true });
    });

    const whitespace = await app.fetch(
      new Request("https://worker.test/test", { method: "POST", headers: { "idempotency-key": "   " } }),
    );
    const accepted = await app.fetch(
      new Request("https://worker.test/test", { method: "POST", headers: { "idempotency-key": "  idem-1  " } }),
    );

    expect(whitespace.status).toBe(400);
    await expect(whitespace.json()).resolves.toMatchObject({ error: { code: "invalid_idempotency_key" } });
    expect(accepted.status).toBe(200);
    expect(seenKeys).toEqual(["idem-1"]);
  });

  it("does not expose an idempotency key for routes that do not require one", async () => {
    let seenKey: string | undefined = "unset";
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async api_key() {
          return principal();
        },
      },
    }).mount(baseContract, async (_context, _principal, guard) => {
      seenKey = guard.idempotencyKey;
      return jsonOk({ ok: true });
    });

    const response = await app.fetch(
      new Request("https://worker.test/test", { headers: { "idempotency-key": "ignored" } }),
    );

    expect(response.status).toBe(200);
    expect(seenKey).toBeUndefined();
  });

  it("converts in-flight idempotency collisions to 409 envelopes", async () => {
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async api_key() {
          return principal();
        },
      },
    }).mount({ ...baseContract, method: "POST", idempotency: "required" }, async () => {
      throw new IdempotencyInFlightError();
    });

    const response = await app.fetch(
      new Request("https://worker.test/test", { method: "POST", headers: { "idempotency-key": "idem" } }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "idempotency_in_flight" } });
  });

  // ADR 0039/0064: limits run after authentication and scope checks, so a
  // missing scope returns 403 without touching rate-limit budget.
  it("checks scopes before rate-limit", async () => {
    const calls: string[] = [];
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async api_key() {
          calls.push("auth");
          return principal([]);
        },
      },
      rateLimitBindings: () => ({
        actor: {
          async limit() {
            calls.push("rate-limit");
            return { success: false };
          },
        },
      }),
    }).mount({ ...baseContract, scopes: ["read"], rateLimit: "actor" }, async () => {
      calls.push("handler");
      return jsonOk({ ok: true });
    });

    const response = await app.fetch(new Request("https://worker.test/test"));

    expect(response.status).toBe(403);
    expect(calls).toEqual(["auth"]);
  });

  it("returns completed idempotency replay before rate-limit", async () => {
    const rateLimitCalls = { count: 0 };
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async api_key() {
          return principal(["publish"]);
        },
      },
      db: () => ({ ok: true }),
      replay: async () => jsonOk({ replay: true }),
      rateLimitBindings: () => ({
        actor: {
          async limit() {
            rateLimitCalls.count += 1;
            return { success: false };
          },
        },
      }),
    }).mount(
      { ...baseContract, method: "POST", scopes: ["publish"], idempotency: "required", rateLimit: "actor" },
      async () => jsonOk({ ok: true }),
    );

    const response = await app.fetch(
      new Request("https://worker.test/test", { method: "POST", headers: { "idempotency-key": "replay" } }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ replay: true });
    expect(rateLimitCalls.count).toBe(0);
  });

  it("rejects completed idempotency replay with 403 when required scopes are absent", async () => {
    const replayCalls = { count: 0 };
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async api_key() {
          return principal([]);
        },
      },
      db: () => ({ ok: true }),
      replay: async () => {
        replayCalls.count += 1;
        return jsonOk({ replay: true });
      },
    }).mount({ ...baseContract, method: "POST", scopes: ["publish"], idempotency: "required" }, async () =>
      jsonOk({ ok: true }),
    );

    const response = await app.fetch(
      new Request("https://worker.test/test", { method: "POST", headers: { "idempotency-key": "replay" } }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
    expect(replayCalls.count).toBe(0);
  });

  it("throws when the registrar emits an undeclared repository error code under enforcement", async () => {
    setContractErrorEnforcement(true);
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async api_key() {
          return principal(["read"]);
        },
      },
      db: () => ({ ok: true }),
    }).mount({ ...baseContract, method: "POST", scopes: ["read"] }, async () => {
      throw new Error("storage_unavailable");
    });

    const response = await app.fetch(new Request("https://worker.test/test", { method: "POST" }));
    expect(response.status).toBe(500);
    setContractErrorEnforcement(undefined);
  });

  it("applies docs links and default headers to handler-emitted contract errors", async () => {
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async api_key() {
          return principal(["read"]);
        },
      },
      docsBaseUrl: () => "https://docs.example.com",
      defaultErrorHeaders: () => ({ "content-security-policy": "default-src 'none'" }),
    }).mount(baseContract, async (_context, _principal, guard) => guard.respondError("rate_limited_artifact"));

    const response = await app.fetch(new Request("https://worker.test/test"));

    expect(response.status).toBe(429);
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "rate_limited_artifact",
        docs: "https://docs.example.com/errors/rate_limited_artifact",
      },
    });
  });

  it("returns forbidden when required scopes are absent", async () => {
    const app = newApp();
    createRegistrar({
      app,
      auth: {
        async api_key() {
          return principal([]);
        },
      },
    }).mount({ ...baseContract, scopes: ["read"] }, async () => jsonOk({ ok: true }));

    const response = await app.fetch(new Request("https://worker.test/test"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });
  it("treats an empty ephemeral provision body as {}", async () => {
    const app = newApp();
    const contract: RouteContract = {
      id: "ephemeral.provision",
      app: "api",
      method: "POST",
      path: "/v1/ephemeral/provision",
      auth: "none",
      scopes: [],
      idempotency: "none",
      rateLimit: "ephemeral_provision",
      allowEmptyBody: true,
      requestSchema: "EphemeralProvisionRequest",
      responseSchema: "EphemeralProvisionResponse",
      errors: [
        "invalid_request",
        "ephemeral_provision_rate_limited",
        "ephemeral_provision_unavailable",
        "database_unavailable",
      ],
    };

    createRegistrar({
      app,
      auth: {
        async none() {
          return { ok: true, principal: { kind: "none" } };
        },
      },
      rateLimitBindings: () => ({
        ephemeralProvisionGlobal: {
          async limit() {
            return { success: true };
          },
        },
        ephemeralProvisionIp: {
          async limit() {
            return { success: true };
          },
        },
      }),
    }).mount(contract, async (_context, _principal, guard) => jsonOk({ received: guard.body }));

    const response = await app.fetch(
      new Request("https://worker.test/v1/ephemeral/provision", {
        method: "POST",
        headers: { "CF-Connecting-IP": "203.0.113.10", "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: {} });
  });

  it("uses only CF-Connecting-IP for ephemeral provision rate-limit keys", async () => {
    const ipLimit = vi.fn(async () => ({ success: true }));
    const app = newApp();
    const contract: RouteContract = {
      id: "ephemeral.provision",
      app: "api",
      method: "POST",
      path: "/v1/ephemeral/provision",
      auth: "none",
      scopes: [],
      idempotency: "none",
      rateLimit: "ephemeral_provision",
      allowEmptyBody: true,
      requestSchema: "EphemeralProvisionRequest",
      responseSchema: "EphemeralProvisionResponse",
      errors: [
        "invalid_request",
        "ephemeral_provision_rate_limited",
        "ephemeral_provision_unavailable",
        "database_unavailable",
      ],
    };

    createRegistrar({
      app,
      auth: {
        async none() {
          return { ok: true, principal: { kind: "none" } };
        },
      },
      rateLimitBindings: () => ({
        ephemeralProvisionGlobal: { limit: vi.fn(async () => ({ success: true })) },
        ephemeralProvisionIp: { limit: ipLimit },
      }),
    }).mount(contract, async () => jsonOk({ ok: true }));

    const accepted = await app.fetch(
      new Request("https://worker.test/v1/ephemeral/provision", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.10",
          "X-Forwarded-For": "198.51.100.20",
        },
      }),
    );
    const missingCfIp = await app.fetch(
      new Request("https://worker.test/v1/ephemeral/provision", {
        method: "POST",
        headers: { "X-Forwarded-For": "198.51.100.20" },
      }),
    );

    expect(accepted.status).toBe(200);
    expect(ipLimit).toHaveBeenCalledTimes(1);
    expect(ipLimit).toHaveBeenCalledWith({ key: "203.0.113.10" });
    expect(missingCfIp.status).toBe(503);
    await expect(missingCfIp.json()).resolves.toMatchObject({ error: { code: "ephemeral_provision_unavailable" } });
  });
});

function newApp(): Hono {
  const app = new Hono();
  app.use("*", requestIdMiddleware());
  return app;
}

function principal(scopes = ["read"]) {
  return {
    ok: true,
    principal: {
      kind: "api_key",
      actor: { type: "api_key", id: "key_1", workspace_id: "w_1", scopes },
    },
  } as const;
}

async function rateLimitedResponse(bindings: {
  actor?: { success: boolean } | Error;
  workspace?: { success: boolean } | Error;
}): Promise<Response> {
  const app = newApp();
  createRegistrar({
    app,
    auth: {
      async api_key() {
        return principal(["read"]);
      },
    },
    rateLimitBindings: () => ({
      actor:
        bindings.actor === undefined
          ? undefined
          : {
              async limit() {
                if (bindings.actor instanceof Error) {
                  throw bindings.actor;
                }
                return bindings.actor;
              },
            },
      workspace:
        bindings.workspace === undefined
          ? undefined
          : {
              async limit() {
                if (bindings.workspace instanceof Error) {
                  throw bindings.workspace;
                }
                return bindings.workspace;
              },
            },
    }),
  }).mount({ ...baseContract, rateLimit: "actor" }, async () => jsonOk({ ok: true }));
  return app.fetch(new Request("https://worker.test/test"));
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
