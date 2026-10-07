import * as Sentry from "@sentry/cloudflare";
import { expect, it, vi } from "vitest";
import { sentryOptions } from "./sentry.js";

Sentry.setAsyncLocalStorageAsyncContextStrategy();

it("exports sanitized POST transactions with the default SDK integrations without reading the body", async () => {
  const transactions: Sentry.Event[] = [];
  const options: Sentry.CloudflareOptions = {
    ...sentryOptions({ SENTRY_DSN: "https://public@example.ingest.sentry.io/1", SENTRY_RELEASE: "release-sha" }, "api"),
    skipOpenTelemetrySetup: true,
    transport: () => ({
      send: async (envelope) => {
        for (const [header, payload] of envelope[1]) {
          if (header.type === "transaction") transactions.push(payload as Sentry.Event);
        }
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  };
  const request = new Request("https://agent-paste.internal/v1/artifacts?token=private-query", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "private-idempotency",
      authorization: "Bearer private-authorization",
      cookie: "session=private-cookie",
      "sentry-trace": "00112233445566778899aabbccddeeff-1122334455667788-1",
    },
    body: JSON.stringify({ files: [{ content: "private-artifact-body" }] }),
  });
  const clone = vi.spyOn(request, "clone");
  let client: ReturnType<typeof Sentry.getClient>;
  await Sentry.wrapRequestHandler({ options, request, context: undefined }, async () => {
    client = Sentry.getClient();
    expect(client?.getIntegrationByName("HttpServer")).toMatchObject({ maxRequestBodySize: "none" });
    return Response.json({ ok: true });
  });
  if (!client) throw new Error("Request handler did not initialize the Sentry client");
  await client.flush();

  expect(clone).not.toHaveBeenCalled();
  expect(transactions).toHaveLength(1);
  expect(transactions[0]).toMatchObject({
    type: "transaction",
    release: "release-sha",
    tags: { "service.name": "agent-paste-api" },
    request: { method: "POST", url: "/v1/artifacts", headers: { "content-type": "application/json" } },
    contexts: { trace: { trace_id: "00112233445566778899aabbccddeeff", parent_span_id: "1122334455667788" } },
  });
  expect(transactions[0]?.request).not.toHaveProperty("data");
  expect(transactions[0]?.request).not.toHaveProperty("cookies");
  expect(transactions[0]?.request).not.toHaveProperty("query_string");
  expect(JSON.stringify(transactions)).not.toContain("private-");
});
