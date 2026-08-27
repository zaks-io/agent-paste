import { describe, expect, it } from "vitest";
import { sentryOptions } from "./sentry.js";

// A capability id and a trace id are both 32 hex characters but are unrelated
// values, so they stay distinct here: redacting one must not depend on losing the other.
const CAPABILITY_ID = "aabbccddeeff00112233445566778899";
const TRACE_ID = "00112233445566778899aabbccddeeff";
const SPAN_ID = "ffeeddccbbaa9988";
const PARENT_SPAN_ID = "1122334455667788";

describe("sentryOptions", () => {
  it("disables Sentry when no DSN is configured", () => {
    expect(sentryOptions({})).toMatchObject({
      dsn: "",
      environment: "dev",
      sendDefaultPii: false,
      dataCollection: {
        userInfo: false,
        httpBodies: [],
        genAI: { inputs: false, outputs: false },
      },
      enabled: false,
      enableLogs: false,
    });
  });

  it("uses the configured DSN and environment without default PII", () => {
    expect(
      sentryOptions({
        SENTRY_DSN: "https://examplePublicKey@example.ingest.sentry.io/1",
        AGENT_PASTE_ENV: "preview",
      }),
    ).toMatchObject({
      dsn: "https://examplePublicKey@example.ingest.sentry.io/1",
      environment: "preview",
      sendDefaultPii: false,
      dataCollection: {
        userInfo: false,
        httpBodies: [],
        genAI: { inputs: false, outputs: false },
      },
      enabled: true,
      enableLogs: true,
    });
  });

  it("keeps Sentry disabled for an empty DSN while preserving the environment", () => {
    expect(sentryOptions({ SENTRY_DSN: "", AGENT_PASTE_ENV: "production" })).toMatchObject({
      dsn: "",
      environment: "production",
      sendDefaultPii: false,
      enabled: false,
      enableLogs: false,
    });
  });

  it("trims the configured DSN before assigning and enabling", () => {
    expect(sentryOptions({ SENTRY_DSN: "  https://examplePublicKey@example.ingest.sentry.io/1  " })).toMatchObject({
      dsn: "https://examplePublicKey@example.ingest.sentry.io/1",
      environment: "dev",
      sendDefaultPii: false,
      enabled: true,
      enableLogs: true,
    });
  });

  it("sanitizes Sentry log attributes before send", () => {
    const options = sentryOptions({ SENTRY_DSN: "https://examplePublicKey@example.ingest.sentry.io/1" });
    expect(
      options.beforeSendLog?.({
        level: "error",
        message: 'failed https://api.test/v1/upload?token=secret with ap_pk_prod_secret and "token":"json_secret"',
        attributes: { token: "secret", safe: "ok" },
      }),
    ).toMatchObject({
      level: "error",
      message: 'failed [url:/v1/upload] with [redacted_api_key] and "token":"[redacted]"',
      attributes: { safe: "ok" },
    });
  });

  it("drops Sentry logs attached to caller-controlled trace context", () => {
    const options = sentryOptions({ SENTRY_DSN: "https://examplePublicKey@example.ingest.sentry.io/1" });
    expect(
      options.beforeSendLog?.({
        level: "error",
        message: "request failed",
        attributes: { "sentry.trace.parent_span_id": "0011223344556677" },
      }),
    ).toBeNull();
  });

  it("sanitizes Sentry error events before send", () => {
    const options = sentryOptions({ SENTRY_DSN: "https://examplePublicKey@example.ingest.sentry.io/1" });
    const event = options.beforeSend?.(
      {
        type: undefined,
        message:
          "failed https://api.test/v1/upload?token=secret with ap_pk_prod_secret token=secret idempotency_key=idem_secret",
        exception: {
          values: [
            {
              type: "Error",
              value: "failed https://api.test/v1/upload?token=secret with Bearer secret content_token=content_secret",
            },
          ],
        },
        request: {
          url: "https://api.test/v1/upload?token=secret#access-link-fragment",
          method: "POST",
          data: { raw: true },
          query_string: "token=secret",
          cookies: { session: "secret" },
          headers: {
            Authorization: "Bearer secret",
            "User-Agent": "vitest",
          },
        },
        user: {
          id: "user_secret",
          email: "secret@example.com",
          ip_address: "127.0.0.1",
        },
        breadcrumbs: [
          {
            message: "fetch https://content.test/v/artifact?expires=1",
            data: {
              safe: "ok",
              signed_url: "https://content.test/v/artifact?token=secret",
              token: "secret",
            },
          },
        ],
        extra: {
          note: "fetch https://content.test/v/artifact?token=secret",
          api_key: "ap_pk_prod_secret",
          access_link_blob: "fragment",
        },
      },
      {},
    );

    expect(event).toMatchObject({
      message: "failed [url:/v1/upload] with [redacted_api_key] token=[redacted] idempotency_key=[redacted]",
      exception: {
        values: [{ type: "Error", value: "failed [url:/v1/upload] with Bearer [redacted] content_token=[redacted]" }],
      },
      request: {
        url: "/v1/upload",
        method: "POST",
        headers: { "User-Agent": "vitest" },
      },
      breadcrumbs: [
        {
          message: "fetch [url:/v/[redacted_content_token]]",
          data: { safe: "ok" },
        },
      ],
      extra: {
        note: "fetch [url:/v/[redacted_content_token]]",
      },
    });
    expect(event).not.toHaveProperty("user");
    expect(JSON.stringify(event)).not.toContain("secret");
    expect(JSON.stringify(event)).not.toContain("ap_pk_prod");
    expect(JSON.stringify(event)).not.toContain("access-link-fragment");
  });

  it("redacts the complete path for capability-host requests", () => {
    const options = sentryOptions({ SENTRY_DSN: "https://examplePublicKey@example.ingest.sentry.io/1" });
    const event = options.beforeSend?.(
      {
        type: undefined,
        request: {
          url: `https://${CAPABILITY_ID}-uc.content.test/private/customer.html`,
          method: "GET",
          headers: {
            Host: `${CAPABILITY_ID}-uc.content.test`,
            capability_ref: CAPABILITY_ID,
          },
        },
        contexts: {
          trace: {
            trace_id: TRACE_ID,
            span_id: SPAN_ID,
          },
        },
        transaction: "GET /private/customer.html",
      },
      {},
    );

    expect(event).toMatchObject({
      request: {
        method: "GET",
        url: "/[redacted_capability_path]",
        headers: {
          Host: "[redacted_capability_host]",
          capability_ref: "[redacted_capability_id]",
        },
      },
      contexts: {
        trace: {
          trace_id: TRACE_ID,
          span_id: SPAN_ID,
        },
      },
      transaction: "[redacted_capability_request]",
    });
    expect(JSON.stringify(event)).not.toContain(CAPABILITY_ID);
    expect(JSON.stringify(event)).not.toContain("private/customer.html");
  });

  it("removes capability host and path attributes from spans", () => {
    const options = sentryOptions({
      SENTRY_DSN: "https://examplePublicKey@example.ingest.sentry.io/1",
      SENTRY_TRACES_SAMPLE_RATE: "1",
    });
    const span = options.beforeSendSpan?.({
      data: {
        "server.address": `${CAPABILITY_ID}-uc.content.test`,
        "url.full": `https://${CAPABILITY_ID}-uc.content.test/private/customer.html`,
        "url.path": "/private/customer.html",
      },
      description: `GET https://${CAPABILITY_ID}-uc.content.test/private/customer.html`,
      op: "http.server",
      span_id: "0123456789abcdef",
      start_timestamp: 1,
      trace_id: TRACE_ID,
    });

    expect(span).toMatchObject({
      data: {},
      description: "[redacted_capability_request]",
      op: "http.server",
    });
    expect(JSON.stringify(span)).not.toContain(CAPABILITY_ID);
    expect(JSON.stringify(span)).not.toContain("private/customer.html");
    // The capability details are gone, but the span still reports its real trace so
    // the capability request remains one coherent trace inside Sentry.
    expect(span?.trace_id).toBe(TRACE_ID);
  });

  // Distributed tracing only works if every service reports the trace id it was
  // handed. Rewriting it here would give each Worker isolate its own id for the
  // same request and no trace would ever join across the browser, web, and api.
  it("preserves caller-propagated trace and span IDs so distributed traces join", () => {
    const options = sentryOptions({
      SENTRY_DSN: "https://examplePublicKey@example.ingest.sentry.io/1",
      SENTRY_TRACES_SAMPLE_RATE: "1",
    });
    const event = options.beforeSend?.(
      {
        type: undefined,
        request: { url: "https://content.test/healthz", method: "GET" },
        contexts: {
          trace: {
            trace_id: TRACE_ID,
            span_id: SPAN_ID,
            parent_span_id: PARENT_SPAN_ID,
          },
        },
      },
      {},
    );
    const span = options.beforeSendSpan?.({
      data: { "url.path": "/healthz" },
      description: "GET /healthz",
      op: "http.server",
      span_id: SPAN_ID,
      start_timestamp: 1,
      trace_id: TRACE_ID,
    });

    expect(event?.contexts?.trace).toMatchObject({
      trace_id: TRACE_ID,
      span_id: SPAN_ID,
      parent_span_id: PARENT_SPAN_ID,
    });
    expect(span?.trace_id).toBe(TRACE_ID);
    expect(span?.span_id).toBe(SPAN_ID);
  });

  it("still sanitizes malformed trace IDs", () => {
    const options = sentryOptions({
      SENTRY_DSN: "https://examplePublicKey@example.ingest.sentry.io/1",
      SENTRY_TRACES_SAMPLE_RATE: "1",
    });
    const span = options.beforeSendSpan?.({
      data: {},
      description: "GET /healthz",
      op: "http.server",
      span_id: SPAN_ID,
      start_timestamp: 1,
      trace_id: `${CAPABILITY_ID}-uc.content.test`,
    });

    expect(span?.trace_id).not.toContain(CAPABILITY_ID);
  });

  it("does not classify ordinary 32-character IDs as capability requests", () => {
    const options = sentryOptions({
      SENTRY_DSN: "https://examplePublicKey@example.ingest.sentry.io/1",
      SENTRY_TRACES_SAMPLE_RATE: "1",
    });
    const event = options.beforeSend?.(
      {
        type: undefined,
        request: {
          method: "GET",
          url: "https://api.test/traces/00112233445566778899aabbccddeeff",
        },
        transaction: "GET /traces/:traceId",
      },
      {},
    );
    const span = options.beforeSendSpan?.({
      data: {
        diagnostic: "keep me",
        trace_reference: "00112233445566778899aabbccddeeff",
      },
      description: "trace 00112233445566778899aabbccddeeff",
      op: "task",
      span_id: "ffeeddccbbaa9988",
      start_timestamp: 1,
      trace_id: "00112233445566778899aabbccddeeff",
    });

    expect(event?.transaction).toBe("GET /traces/:traceId");
    expect(span).toMatchObject({
      data: {
        diagnostic: "keep me",
        trace_reference: "[redacted_capability_id]",
      },
      description: "trace [redacted_capability_id]",
      op: "task",
    });
  });

  it("adds a configured tracing sample rate only when Sentry is enabled", () => {
    expect(
      sentryOptions({
        SENTRY_DSN: "https://examplePublicKey@example.ingest.sentry.io/1",
        SENTRY_TRACES_SAMPLE_RATE: " 0.2 ",
      }),
    ).toMatchObject({
      enabled: true,
      tracesSampleRate: 0.2,
    });
    expect(sentryOptions({ SENTRY_TRACES_SAMPLE_RATE: "0.2" })).not.toHaveProperty("tracesSampleRate");
  });

  it("falls back to the default sample rate when the configured one is invalid", () => {
    expect(
      sentryOptions({
        SENTRY_DSN: "https://examplePublicKey@example.ingest.sentry.io/1",
        SENTRY_TRACES_SAMPLE_RATE: "2",
      }),
    ).toMatchObject({ tracesSampleRate: 1 });
    expect(
      sentryOptions({
        SENTRY_DSN: "https://examplePublicKey@example.ingest.sentry.io/1",
        SENTRY_TRACES_SAMPLE_RATE: "not-a-number",
      }),
    ).toMatchObject({ tracesSampleRate: 1 });
  });

  it("traces by default so an enabled Worker joins distributed traces without extra config", () => {
    expect(sentryOptions({ SENTRY_DSN: "https://examplePublicKey@example.ingest.sentry.io/1" })).toMatchObject({
      enabled: true,
      tracesSampleRate: 1,
      // Service bindings bypass global fetch instrumentation; this carries the trace across them.
      enableRpcTracePropagation: true,
    });
    expect(sentryOptions({})).not.toHaveProperty("tracesSampleRate");
  });
});
