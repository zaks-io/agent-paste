// @ts-nocheck
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createRootRouteWithContext: () => (config: Record<string, unknown>) => ({
    ...config,
    useLoaderData: () => ({
      webBaseUrl: "https://app.agent-paste.sh",
      sentry: { dsn: "https://sentry.test/dsn", environment: "test" },
      analyticsToken: "analytics-token",
      optionalAnalyticsDisabled: false,
    }),
  }),
  HeadContent: () => null,
  Outlet: () => null,
  Scripts: () => null,
  useRouter: () => ({}),
}));

vi.mock("../src/lib/sentry-browser", () => ({
  captureBrowserException: vi.fn(),
  initBrowserSentry: vi.fn(),
}));

vi.mock("../src/rpc/web-loaders", () => ({
  loadRootEnvFn: vi.fn(),
}));

import { Route } from "../src/routes/__root";

const loaderData = {
  webBaseUrl: "https://app.agent-paste.sh",
  sentry: { dsn: "https://sentry.test/dsn", environment: "test", tracesSampleRate: 1 },
  traceMeta: {
    sentryTrace: "0011223344556677889900aabbccddee-1122334455667788-1",
    baggage: "sentry-environment=test",
  },
  analyticsToken: "analytics-token",
  optionalAnalyticsDisabled: false,
};

function metaContent(head: { meta?: Array<Record<string, unknown>> }, name: string): unknown {
  return head.meta?.find((tag) => tag.name === name)?.content;
}

describe("__root route head", () => {
  it("keeps analytics scripts on normal app routes", () => {
    const head = Route.head({
      loaderData,
      matches: [{ routeId: "__root__", loaderData }, { routeId: "/v/$artifactId" }],
    });

    expect(head.scripts).toEqual([
      {
        src: "https://static.cloudflareinsights.com/beacon.min.js",
        defer: true,
        "data-cf-beacon": '{"token":"analytics-token"}',
      },
    ]);
  });

  it("hands the browser the Worker trace so the pageload transaction joins it", () => {
    const head = Route.head({
      loaderData,
      matches: [{ routeId: "__root__", loaderData }, { routeId: "/v/$artifactId" }],
    });

    expect(metaContent(head, "sentry-trace")).toBe("0011223344556677889900aabbccddee-1122334455667788-1");
    expect(metaContent(head, "baggage")).toBe("sentry-environment=test");
  });
});
