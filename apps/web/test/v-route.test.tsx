// @ts-nocheck
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The clean PRIVATE handoff viewer at /v/<artifactId>. These tests pin the
// security-relevant contract: the loader gate redirects an unauthed caller
// (and never reads the artifact for them), and provisions the member before the
// owner-scoped artifact read so a first-login owner is not shown an empty state.
const h = vi.hoisted(() => ({
  loaderData: { redirectTo: null } as { redirectTo: string | null },
  params: { artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" },
  session: { user: { email: "owner@example.com" } } as unknown,
  ensured: [] as string[],
  assign: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useLoaderData: () => h.loaderData,
    useParams: () => h.params,
  }),
  Link: ({ children }: { children: unknown }) => children,
}));

vi.mock("@tanstack/react-query", () => ({
  queryOptions: (opts: unknown) => opts,
  useQuery: () => ({
    data: { data: { title: "My Report", viewer: { iframe_src: "https://c/x", render_mode: "html" } } },
  }),
}));

vi.mock("../src/rpc/web-loaders", () => ({
  loadAuthedSessionFn: () => Promise.resolve(h.session),
}));

vi.mock("../src/lib/queries", () => ({
  // Tag each query so the loader test can assert which reads ran and in order.
  webSessionQuery: () => "webSessionQuery",
  artifactQuery: (id: string) => `artifactQuery:${id}`,
}));

vi.mock("../src/components/artifacts/ArtifactLiveViewer", () => ({
  ArtifactLiveViewer: ({ artifactId, chrome }: { artifactId: string; chrome: boolean }) => (
    <div data-testid="live-viewer" data-artifact={artifactId} data-chrome={String(chrome)} />
  ),
  useLastGoodArtifact: (_id: string, artifact: unknown) => artifact ?? null,
}));

vi.mock("@agent-paste/ui", () => ({ Wordmark: () => <span data-testid="wordmark" /> }));
vi.mock("../src/lib/page-meta", () => ({ dashboardPageMeta: () => ({}) }));

import { Route } from "../src/routes/v.$artifactId";

function makeContext() {
  return {
    queryClient: {
      ensureQueryData: vi.fn(async (key: string) => {
        h.ensured.push(key);
      }),
    },
  };
}

describe("/v/$artifactId route", () => {
  beforeEach(() => {
    h.loaderData = { redirectTo: null };
    h.session = { user: { email: "owner@example.com" } };
    h.ensured = [];
    h.assign.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign: h.assign },
    });
  });

  it("loader redirects an unauthed caller and never reads the artifact", async () => {
    h.session = { redirectTo: "/api/auth/sign-in" };
    const context = makeContext();
    const result = await Route.loader({
      context,
      params: h.params,
      location: { pathname: `/v/${h.params.artifactId}`, searchStr: "" },
    });
    expect(result).toEqual({ redirectTo: "/api/auth/sign-in" });
    // No artifact (or member) read happens for an unauthenticated caller.
    expect(context.queryClient.ensureQueryData).not.toHaveBeenCalled();
  });

  it("loader provisions the member before the owner-scoped artifact read", async () => {
    const context = makeContext();
    const result = await Route.loader({
      context,
      params: h.params,
      location: { pathname: `/v/${h.params.artifactId}`, searchStr: "" },
    });
    expect(result).toEqual({ redirectTo: null });
    // webSessionQuery (provisioning) must precede the artifactQuery read.
    expect(h.ensured).toEqual(["webSessionQuery", `artifactQuery:${h.params.artifactId}`]);
  });

  it("component renders the chromeless live viewer when authed", () => {
    render(<Route.component />);
    const viewer = screen.getByTestId("live-viewer");
    expect(viewer.getAttribute("data-artifact")).toBe(h.params.artifactId);
    expect(viewer.getAttribute("data-chrome")).toBe("false");
  });

  it("component redirects to sign in when the loader returned a redirect", () => {
    h.loaderData = { redirectTo: "/api/auth/sign-in" };
    render(<Route.component />);
    expect(screen.queryByTestId("live-viewer")).toBeNull();
    expect(h.assign).toHaveBeenCalledWith("/api/auth/sign-in");
  });
});
