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
          release: "agent-paste@commit",
          tracesSampleRate: 0.25,
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
      release: "agent-paste@commit",
      sendDefaultPii: false,
      integrations: ["browser-tracing"],
      tracesSampleRate: 0.25,
      propagateTraceparent: true,
      initialScope: { tags: { "service.name": "agent-paste-apex-browser" } },
      beforeSendSpan: expect.any(Function),
      tracePropagationTargets: expect.any(Array),
    });
    const options = sentry.init.mock.calls[0]?.[0];
    const span = { span_id: "abc", data: { "http.request.method": "GET" } };
    expect(options.beforeSendSpan(span)).toEqual({
      ...span,
      data: { ...span.data, "service.name": "agent-paste-apex-browser" },
    });
  });

  it("propagates only to same-origin paths and trusted API and upload hosts", async () => {
    vi.stubGlobal("window", {});
    const { initApexBrowserSentry } = await loadSentryBrowser();
    await initApexBrowserSentry(vi.fn(async () => Response.json({ sentry: { dsn: "https://sentry.test/dsn" } })));
    const targets = sentry.init.mock.calls[0]?.[0].tracePropagationTargets as RegExp[];
    for (const url of [
      "/api/auth/sign-in",
      "https://api.agent-paste.sh/v1/healthz",
      "https://upload.preview.agent-paste.sh/v1/upload-sessions",
      "https://agent-paste-api-preview.isaac-a46.workers.dev/v1/healthz",
      "https://agent-paste-upload-pr-123.isaac-a46.workers.dev/v1/upload-sessions",
    ]) {
      expect(
        targets.some((target) => target.test(url)),
        url,
      ).toBe(true);
    }
    for (const url of [
      "//external.example/path",
      "https://api.agent-paste.sh.attacker.example/v1/healthz",
      "https://xxxxx-xxxxx-xxxxx-xxxxx.agent-paste.link/",
      "https://agent-paste-content-preview.isaac-a46.workers.dev/",
      "https://agent-paste-api-pr-123.attacker.workers.dev/v1/healthz",
    ]) {
      expect(
        targets.some((target) => target.test(url)),
        url,
      ).toBe(false);
    }
  });

  it("skips initialization when the runtime config has no DSN", async () => {
    vi.stubGlobal("window", {});
    const { initApexBrowserSentry } = await loadSentryBrowser();

    await initApexBrowserSentry(vi.fn(async () => Response.json({ sentry: { dsn: null, environment: "dev" } })));

    expect(sentry.init).not.toHaveBeenCalled();
  });
});
