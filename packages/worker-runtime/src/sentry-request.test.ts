import * as Sentry from "@sentry/cloudflare";
import { describe, expect, it } from "vitest";
import { sentryOptions } from "./sentry.js";
import { traceServiceRequest } from "./sentry-request.js";

const TRACE_ID = "00112233445566778899aabbccddeeff";
const PARENT_ID = "1122334455667788";
const DSN = "https://public@example.ingest.sentry.io/1";

Sentry.setAsyncLocalStorageAsyncContextStrategy();

function options(service: "mcp" | "api") {
  return {
    ...sentryOptions({ SENTRY_DSN: DSN, SENTRY_RELEASE: "release-sha", AGENT_PASTE_ENV: "preview" }, service),
    defaultIntegrations: false as const,
    skipOpenTelemetrySetup: true,
    transport: () => ({ send: async () => ({ statusCode: 200 }), flush: async () => true }),
  };
}

describe("service request tracing with the pinned SDK", () => {
  it.each(["1", "0"])("continues HTTP/RPC context and parent sampling %s", async (sampled) => {
    const request = new Request("https://mcp.preview.agent-paste.sh/mcp", {
      headers: {
        "sentry-trace": `${TRACE_ID}-${PARENT_ID}-${sampled}`,
        baggage: `sentry-trace_id=${TRACE_ID},sentry-environment=preview,sentry-release=release-sha,sentry-sampled=${sampled === "1"}`,
      },
    });
    let forwardedTrace = "";
    let responseTrace = "";
    await Sentry.wrapRequestHandler({ options: options("mcp"), request, context: undefined }, async () => {
      return traceServiceRequest(
        new Request("https://agent-paste.internal/v1/artifacts", { headers: { "x-request-id": "request-id" } }),
        "MCP artifacts.list",
        async (forwarded) => {
          expect(forwarded.headers.get("x-request-id")).toBe("request-id");
          forwardedTrace = forwarded.headers.get("sentry-trace") ?? "";
          expect(forwardedTrace.split("-")[0]).toBe(TRACE_ID);
          expect(forwarded.headers.get("traceparent")).toBe(
            `00-${TRACE_ID}-${forwardedTrace.split("-")[1]}-0${sampled}`,
          );
          expect(forwarded.headers.get("baggage")).toContain("sentry-release=release-sha");
          return Sentry.wrapRequestHandler(
            { options: options("api"), request: forwarded, context: undefined },
            async () => {
              const span = Sentry.getActiveSpan();
              expect(span).toBeDefined();
              const json = Sentry.spanToJSON(span!);
              expect(json.trace_id).toBe(TRACE_ID);
              expect(json.parent_span_id).toBe(forwardedTrace.split("-")[1]);
              responseTrace = Sentry.getTraceData()["sentry-trace"] ?? "";
              expect(responseTrace.split("-")[2]).toBe(sampled);
              return Response.json({ ok: true });
            },
          );
        },
      );
    });
    expect(responseTrace.split("-")[0]).toBe(TRACE_ID);
    expect(responseTrace.split("-")[1]).not.toBe(forwardedTrace.split("-")[1]);
  });

  it("keeps upstream failures visible to the caller", async () => {
    const error = new Error("upstream unavailable");
    await expect(
      traceServiceRequest(new Request("https://agent-paste.internal/healthz"), "GET API", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
