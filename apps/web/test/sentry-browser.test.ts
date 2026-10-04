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

  it("identifies browser errors and spans with the service and configured release", async () => {
    const { initBrowserSentry } = await import("../src/lib/sentry-browser");
    initBrowserSentry({ dsn: "https://sentry.test/dsn", release: "agent-paste@commit" }, {});
    const options = sentry.init.mock.calls[0]?.[0];
    expect(options.release).toBe("agent-paste@commit");
    expect(options.initialScope).toEqual({ tags: { "service.name": "agent-paste-web-browser" } });
    const span = { span_id: "abc", data: { "http.request.method": "GET" } };
    expect(options.beforeSendSpan(span)).toEqual({
      ...span,
      data: { ...span.data, "service.name": "agent-paste-web-browser" },
    });
  });

  it("propagates only to same-origin paths and trusted API and upload hosts", async () => {
    const { initBrowserSentry } = await import("../src/lib/sentry-browser");
    initBrowserSentry({ dsn: "https://sentry.test/dsn" }, {});
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

  it("captures browser exceptions", async () => {
    const { captureBrowserException } = await import("../src/lib/sentry-browser");
    const error = new Error("failure");
    captureBrowserException(error);
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });
});
