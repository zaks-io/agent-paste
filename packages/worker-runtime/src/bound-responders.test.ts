import { requestIdMiddleware } from "@agent-paste/auth";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { boundRespondersMiddleware, getBoundResponders } from "./bound-responders.js";

describe("bound responders", () => {
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
