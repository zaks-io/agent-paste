import { describe, expect, it } from "vitest";
import { sentryOptions } from "./sentry.js";

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
        message: "failed https://api.test/v1/upload?token=secret with ap_pk_prod_secret",
        attributes: { token: "secret", safe: "ok" },
      }),
    ).toMatchObject({
      level: "error",
      message: "failed [url:/v1/upload] with [redacted_api_key]",
      attributes: { safe: "ok" },
    });
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
    expect(JSON.stringify(event)).not.toContain("secret");
    expect(JSON.stringify(event)).not.toContain("ap_pk_prod");
    expect(JSON.stringify(event)).not.toContain("access-link-fragment");
  });
});
