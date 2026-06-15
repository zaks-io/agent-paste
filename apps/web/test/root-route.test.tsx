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
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/" } }),
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
  sentry: { dsn: "https://sentry.test/dsn", environment: "test" },
  analyticsToken: "analytics-token",
  optionalAnalyticsDisabled: false,
};

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

  it("omits analytics scripts on Access Link routes", () => {
    const head = Route.head({
      loaderData,
      matches: [{ routeId: "__root__", loaderData }, { routeId: "/al/$publicId" }],
    });

    expect(head.scripts).toEqual([]);
  });
});
