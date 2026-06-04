import { describe, expect, it, vi } from "vitest";

const setupRouterSsrQueryIntegration = vi.fn();
const createTanStackRouter = vi.fn((options: unknown) => ({ options }));

vi.mock("@tanstack/react-router", () => ({
  createRouter: (options: unknown) => createTanStackRouter(options),
}));

vi.mock("@tanstack/react-router-ssr-query", () => ({
  setupRouterSsrQueryIntegration: (...args: unknown[]) => setupRouterSsrQueryIntegration(...args),
}));

vi.mock("../src/routeTree.gen", () => ({ routeTree: { id: "__root__" } }));

import { getRouter } from "../src/router";

describe("getRouter", () => {
  it("builds a router with a QueryClient in context and wires the SSR-query integration", () => {
    const router = getRouter();

    expect(router.options.context.queryClient).toBeDefined();
    expect(setupRouterSsrQueryIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ router, queryClient: router.options.context.queryClient }),
    );
  });

  it("configures intent preloading and scroll restoration", () => {
    const router = getRouter();
    expect(router.options.defaultPreload).toBe("intent");
    expect(router.options.scrollRestoration).toBe(true);
  });
});
