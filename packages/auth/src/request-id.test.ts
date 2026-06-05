import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { buildErrorBody, docsUrlFor, REQUEST_ID_HEADER, requestIdMiddleware, resolveRequestId } from "./request-id.js";

describe("request id helpers", () => {
  it("accepts a valid inbound request id or mints a uuid", () => {
    const valid = new Request("https://api.test", {
      headers: { [REQUEST_ID_HEADER]: "req-12345678" },
    });
    expect(resolveRequestId(valid)).toBe("req-12345678");
    expect(resolveRequestId(new Request("https://api.test"))).toMatch(/^[0-9a-f-]{36}$/i);
    expect(
      resolveRequestId(new Request("https://api.test", { headers: { [REQUEST_ID_HEADER]: "bad id with spaces" } })),
    ).not.toBe("bad id with spaces");
  });

  it("builds error bodies with optional docs links", () => {
    expect(
      buildErrorBody({
        code: "rate_limited_actor",
        requestId: "req-1",
        docsBaseUrl: "https://docs.test",
      }),
    ).toMatchObject({
      error: {
        code: "rate_limited_actor",
        request_id: "req-1",
        docs: "https://docs.test/errors/rate_limited_actor",
      },
    });
    expect(docsUrlFor("not_found", "https://docs.test/")).toBeUndefined();
    expect(docsUrlFor("rate_limited_actor", undefined)).toBeUndefined();
  });

  it("sets and echoes request id through middleware", async () => {
    const app = new Hono();
    app.use("*", requestIdMiddleware());
    app.get("/test", (context) => context.text(context.get("requestId")));
    const response = await app.fetch(
      new Request("https://api.test/test", { headers: { [REQUEST_ID_HEADER]: "req-abcd1234" } }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("req-abcd1234");
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe("req-abcd1234");
  });
});
