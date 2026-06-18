import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  browserTracingIntegration: vi.fn(() => "browser-tracing"),
  init: vi.fn(),
}));

vi.mock("@sentry/browser", () => sentry);

async function loadSentryBrowser() {
  return import("./sentry-browser");
}

describe("apex browser Sentry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    sentry.browserTracingIntegration.mockClear();
    sentry.init.mockReset();
  });

  it("does nothing outside the browser", async () => {
    const { initApexBrowserSentry } = await loadSentryBrowser();
    const fetcher = vi.fn();

    await initApexBrowserSentry(fetcher);

    expect(fetcher).not.toHaveBeenCalled();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("loads the apex client config and initializes Sentry", async () => {
    vi.stubGlobal("window", {});
    const { APEX_CLIENT_CONFIG_PATH, initApexBrowserSentry } = await loadSentryBrowser();
    const fetcher = vi.fn(async () =>
      Response.json({
        sentry: {
          dsn: " https://public@example.ingest.us.sentry.io/1 ",
          environment: "production",
        },
      }),
    );

    await initApexBrowserSentry(fetcher);

    expect(fetcher).toHaveBeenCalledWith(APEX_CLIENT_CONFIG_PATH, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    expect(sentry.browserTracingIntegration).toHaveBeenCalledTimes(1);
    expect(sentry.init).toHaveBeenCalledWith({
      dsn: "https://public@example.ingest.us.sentry.io/1",
      environment: "production",
      sendDefaultPii: false,
      integrations: ["browser-tracing"],
      tracesSampleRate: 0.1,
    });
  });

  it("skips initialization when the runtime config has no DSN", async () => {
    vi.stubGlobal("window", {});
    const { initApexBrowserSentry } = await loadSentryBrowser();

    await initApexBrowserSentry(vi.fn(async () => Response.json({ sentry: { dsn: null, environment: "dev" } })));

    expect(sentry.init).not.toHaveBeenCalled();
  });
});
