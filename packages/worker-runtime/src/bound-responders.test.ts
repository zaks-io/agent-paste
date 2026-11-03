import { requestIdMiddleware } from "@agent-paste/auth";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { boundRespondersMiddleware, getBoundResponders } from "./bound-responders.js";

describe("bound responders", () => {
  it("preserves structured details and extra headers through the three-argument responder", async () => {
    const app = new Hono();
    app.use("*", requestIdMiddleware());
    app.use("*", boundRespondersMiddleware({}));
    app.get("/quota", (context) =>
      getBoundResponders(context).respondError("storage_quota_exceeded", "Quota reached", {
        details: { budget_bytes: 10, required_bytes: 11 },
      }),
    );
    app.get("/cleanup", (context) =>
      getBoundResponders(context).respondError("storage_unavailable", "blob_cleanup_in_progress", {
        headers: { "Retry-After": "60" },
      }),
    );
    const response = await app.request("/quota");
    expect(response.status).toBe(429);
    expect(response.headers.has("Retry-After")).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "storage_quota_exceeded", details: { budget_bytes: 10, required_bytes: 11 } },
    });
    expect((await app.request("/cleanup")).headers.get("Retry-After")).toBe("60");
  });
  it("injects docs links and default headers on handler-emitted errors", async () => {
    const app = new Hono();
    app.use("*", requestIdMiddleware());
    app.use(
      "*",
      boundRespondersMiddleware({
        docsBaseUrl: () => "https://docs.example.com",
        defaultErrorHeaders: () => ({ "content-security-policy": "default-src 'none'" }),
      }),
    );
    app.get("/fail", (context) => getBoundResponders(context).respondError("rate_limited_actor"));

    const response = await app.fetch(
      new Request("https://worker.test/fail", { headers: { "x-request-id": "req-12345678" } }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(response.headers.get("x-request-id")).toBe("req-12345678");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "rate_limited_actor",
        docs: "https://docs.example.com/errors/rate_limited_actor",
      },
    });
  });

  it("merges default headers into handler-emitted JSON responses", async () => {
    const app = new Hono();
    app.use("*", requestIdMiddleware());
    app.use(
      "*",
      boundRespondersMiddleware({
        defaultErrorHeaders: () => ({ "referrer-policy": "no-referrer" }),
      }),
    );
    app.get("/ok", (context) => getBoundResponders(context).respondJson({ ok: true }));

    const response = await app.fetch(new Request("https://worker.test/ok"));

    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
