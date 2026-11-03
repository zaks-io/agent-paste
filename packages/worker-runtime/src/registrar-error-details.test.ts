import { requestIdMiddleware } from "@agent-paste/auth";
import { routeContracts } from "@agent-paste/contracts";
import { RepositoryError } from "@agent-paste/db";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createRegistrar, type GuardState } from "./registrar.js";

const whoami = routeContracts.find((route) => route.id === "whoami.get");
if (!whoami) throw new Error("whoami.get contract missing");
const contract = {
  ...whoami,
  errors: [...whoami.errors, "commit_conflict", "storage_unavailable"] as const,
};

function appWithHandler(handler: (guard: GuardState<typeof contract>) => Response | Promise<Response>) {
  const app = new Hono();
  app.use("*", requestIdMiddleware());
  createRegistrar({
    app,
    auth: {
      async api_key() {
        return {
          ok: true,
          principal: { kind: "api_key", actor: { type: "api_key", id: "k", workspace_id: "w", scopes: ["read"] } },
        };
      },
    },
    rateLimitBindings: () => ({
      actor: { limit: async () => ({ success: true }) },
      workspace: { limit: async () => ({ success: true }) },
    }),
  }).mount(contract, async (_context, _principal, guard) => handler(guard));
  return app;
}

describe("registrar error details", () => {
  it("passes the third responder argument through with headers", async () => {
    const details = { kind: "head", head_revision_id: null };
    const app = appWithHandler((guard) =>
      guard.respondError("commit_conflict", "head changed", { details, headers: { "X-Conflict": "head" } }),
    );
    const response = await app.request("/v1/whoami");
    expect(response.status).toBe(409);
    expect(response.headers.get("X-Conflict")).toBe("head");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "commit_conflict", details } });
  });

  it("preserves typed repository conflict details", async () => {
    const details = { kind: "paths", head_revision_id: null, conflicts: [] };
    const app = appWithHandler(() => {
      throw new RepositoryError("commit_conflict", { details });
    });
    const response = await app.request("/v1/whoami");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "commit_conflict", details } });
  });

  it("makes a blob cleanup conflict retryable without exposing an internal code", async () => {
    const app = appWithHandler(() => {
      throw new RepositoryError("blob_cleanup_in_progress");
    });
    const response = await app.request("/v1/whoami");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "storage_unavailable", message: "blob_cleanup_in_progress" },
    });
  });
});
