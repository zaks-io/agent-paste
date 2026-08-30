import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  init: vi.fn(),
  tanstackRouterBrowserTracingIntegration: vi.fn(() => "router-integration"),
}));

vi.mock("@sentry/tanstackstart-react", () => sentry);

describe("browser Sentry", () => {
  beforeEach(() => {
    vi.resetModules();
    sentry.captureException.mockReset();
    sentry.init.mockReset();
  });

  it("samples traces at the Worker rate", async () => {
    const { initBrowserSentry } = await import("../src/lib/sentry-browser");
    initBrowserSentry({ dsn: "https://sentry.test/dsn", environment: "test", tracesSampleRate: 0.25 }, {});
    expect(sentry.init.mock.calls[0]?.[0].tracesSampleRate).toBe(0.25);
  });

  it("captures browser exceptions", async () => {
    const { captureBrowserException } = await import("../src/lib/sentry-browser");
    const error = new Error("failure");
    captureBrowserException(error);
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });
});
