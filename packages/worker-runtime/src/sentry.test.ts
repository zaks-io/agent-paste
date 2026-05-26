import { describe, expect, it } from "vitest";
import { sentryOptions } from "./sentry.js";

describe("sentryOptions", () => {
  it("disables Sentry when no DSN is configured", () => {
    expect(sentryOptions({})).toMatchObject({
      dsn: "",
      environment: "dev",
      sendDefaultPii: false,
      enabled: false,
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
      enabled: true,
    });
  });

  it("keeps Sentry disabled for an empty DSN while preserving the environment", () => {
    expect(sentryOptions({ SENTRY_DSN: "", AGENT_PASTE_ENV: "production" })).toMatchObject({
      dsn: "",
      environment: "production",
      sendDefaultPii: false,
      enabled: false,
    });
  });

  it("trims the configured DSN before assigning and enabling", () => {
    expect(sentryOptions({ SENTRY_DSN: "  https://examplePublicKey@example.ingest.sentry.io/1  " })).toMatchObject({
      dsn: "https://examplePublicKey@example.ingest.sentry.io/1",
      environment: "dev",
      sendDefaultPii: false,
      enabled: true,
    });
  });
});
