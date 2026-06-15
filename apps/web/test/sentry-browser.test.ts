import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  init: vi.fn(),
  tanstackRouterBrowserTracingIntegration: vi.fn(() => "router-integration"),
}));

vi.mock("@sentry/tanstackstart-react", () => sentry);

async function loadSentryBrowser() {
  return import("../src/lib/sentry-browser");
}

describe("browser Sentry route policy", () => {
  beforeEach(() => {
    vi.resetModules();
    sentry.captureException.mockReset();
    sentry.init.mockReset();
    sentry.tanstackRouterBrowserTracingIntegration.mockClear();
    window.history.pushState(null, "", "/dashboard");
  });

  it("does not initialize on Access Link viewer paths", async () => {
    const { initBrowserSentry } = await loadSentryBrowser();

    initBrowserSentry({ dsn: "https://sentry.test/dsn", environment: "test" }, {}, "/al/pub_123");

    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("drops events and transactions after navigating to an Access Link viewer", async () => {
    const { initBrowserSentry } = await loadSentryBrowser();
    const event = { event_id: "evt_1" };

    initBrowserSentry({ dsn: "https://sentry.test/dsn", environment: "test" }, {}, "/dashboard");

    const options = sentry.init.mock.calls[0]?.[0];
    expect(options.beforeSend(event)).toBe(event);
    expect(options.beforeSendTransaction(event)).toBe(event);

    window.history.pushState(null, "", "/al/pub_123");
    expect(options.beforeSend(event)).toBeNull();
    expect(options.beforeSendTransaction(event)).toBeNull();
  });

  it("does not capture root errors on Access Link viewer paths", async () => {
    const { captureBrowserException } = await loadSentryBrowser();

    captureBrowserException(new Error("blocked"), "/al/pub_123");
    expect(sentry.captureException).not.toHaveBeenCalled();

    const error = new Error("allowed");
    captureBrowserException(error, "/dashboard");
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });
});
