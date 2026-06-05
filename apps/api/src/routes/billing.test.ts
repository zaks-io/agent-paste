import type { Principal } from "@agent-paste/worker-runtime";
import { createBoundResponders } from "@agent-paste/worker-runtime";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppContext, Env } from "../env.js";
import { resolveBillingMemberCtx } from "./billing.js";

const BOUND_RESPONDERS_KEY = "boundResponders";

/** A local SqlExecutor stub: resolveBillingExecutor accepts any object exposing query + transaction. */
const fakeExecutor = {
  query: async () => ({ rows: [] }),
  transaction: async (fn: (tx: unknown) => unknown) => fn({}),
};

const memberPrincipal: Principal = {
  kind: "workos_access_token",
  actor: { type: "member", id: "user_1", workspace_id: "ws_1" },
} as unknown as Principal;

const apiKeyPrincipal: Principal = {
  kind: "api_key",
  actor: { type: "api_key", id: "key_1", workspace_id: "ws_1" },
} as unknown as Principal;

/** Builds a real Hono context with bound responders, the seam getBoundResponders needs. */
async function contextFor(env: Partial<Env>): Promise<AppContext> {
  const app = new Hono();
  let captured: AppContext | undefined;
  app.use("*", async (c, next) => {
    c.set(BOUND_RESPONDERS_KEY, createBoundResponders(c));
    captured = c as unknown as AppContext;
    await next();
    return c.body(null);
  });
  await app.fetch(new Request("https://api.test/v1/web/billing"), env as Env);
  if (!captured) {
    throw new Error("failed to capture context");
  }
  return captured;
}

describe("resolveBillingMemberCtx", () => {
  it("rejects with not_found when billing is disabled", async () => {
    const ctx = await contextFor({ BILLING_ENABLED: "false", DB: fakeExecutor as never });
    const result = resolveBillingMemberCtx(ctx, memberPrincipal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(404);
    }
  });

  it("rejects with forbidden when the principal is not a Workspace Member", async () => {
    const ctx = await contextFor({ BILLING_ENABLED: "true", DB: fakeExecutor as never });
    const result = resolveBillingMemberCtx(ctx, apiKeyPrincipal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  it("rejects with database_unavailable when no executor resolves", async () => {
    const ctx = await contextFor({ BILLING_ENABLED: "true" });
    const result = resolveBillingMemberCtx(ctx, memberPrincipal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
    }
  });

  it("resolves a workspace-scoped context for a member when billing is on", async () => {
    const ctx = await contextFor({ BILLING_ENABLED: "true", DB: fakeExecutor as never });
    const result = resolveBillingMemberCtx(ctx, memberPrincipal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.workspaceId).toBe("ws_1");
      expect(typeof result.ctx.db.query).toBe("function");
      expect(typeof result.ctx.respondJson).toBe("function");
    }
  });
});
