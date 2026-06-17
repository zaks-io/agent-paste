// @ts-nocheck
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../src/components/ui/ToastProvider";

const state = vi.hoisted(() => ({
  loaderData: undefined as unknown,
  params: { artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", publicId: "pub_1" },
}));

const liveUpdates = vi.hoisted(() => ({
  lastInput: null as {
    onPointer?: (pointer: { revision_id: string; iframe_src: string; render_mode: string }) => void;
    onRevoked?: () => void;
  } | null,
  close: vi.fn(),
}));

const getArtifactFn = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    <TConfig extends Record<string, unknown>>(config: TConfig) => ({
      ...config,
      useLoaderData: () => state.loaderData,
      useParams: () => state.params,
    }),
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ children }: { children: unknown }) => children,
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      inputValidator: () => builder,
      handler: (handler: (input?: unknown) => unknown) => (input?: unknown) => handler(input),
    };
    return builder;
  },
}));

vi.mock("@workos/authkit-tanstack-react-start", () => ({
  getAuth: () => ({ user: { email: "user@example.com" }, accessToken: "workos-token" }),
}));

vi.mock("../src/server/api-client", () => ({
  apiFetchOrEmpty: vi.fn(),
}));

// The dashboard route reads through useSuspenseQuery, whose queryFn is
// getArtifactFn. Driving this mock lets the post-revoke refetch return a
// revoked artifact. The access-link/revision queries are stubbed empty since
// this suite only exercises the live viewer.
const emptyAccessLinks = {
  data: { items: [], page_info: { next_cursor: null, has_more: false } },
  empty: true,
  error: null,
};
const emptyRevisions = {
  data: { artifact_id: state.params.artifactId, items: [], page_info: { next_cursor: null, has_more: false } },
  empty: true,
  error: null,
};
vi.mock("../src/rpc/web-loaders", () => ({
  getArtifactFn: (...args: unknown[]) => getArtifactFn(...args),
  listArtifactAccessLinksFn: () => Promise.resolve(emptyAccessLinks),
  listArtifactRevisionsFn: () => Promise.resolve(emptyRevisions),
}));

vi.mock("../src/lib/live-updates", () => ({
  connectLiveUpdates: (input: typeof liveUpdates.lastInput & Record<string, unknown>) => {
    liveUpdates.lastInput = input;
    return { close: liveUpdates.close };
  },
}));

const contentIframeSrc = "https://content.test/v/art.rev/index.html";

function artifactDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: state.params.artifactId,
    title: "Artifact One",
    status: "Published",
    latest_revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    pinned: false,
    lockdown: false,
    last_published_at: "2026-01-01T00:00:00.000Z",
    auto_delete_at: null,
    entrypoint: "index.html",
    file_count: 1,
    size_bytes: 1024,
    viewer: {
      iframe_src: contentIframeSrc,
      render_mode: "html",
    },
    ...overrides,
  };
}

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

describe("viewer live-update revocation", () => {
  beforeEach(() => {
    liveUpdates.lastInput = null;
    liveUpdates.close.mockReset();
    getArtifactFn.mockReset();
    state.params = { artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", publicId: "pub_1" };
    window.location.hash = "#signed-blob";
    window.history.replaceState({}, "", "/al/pub_1#signed-blob");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("clears the Access Link iframe when live updates are revoked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/access-links/resolve") {
          return new Response(
            JSON.stringify({
              render_mode: "html",
              iframe_src: contentIframeSrc,
              title: "Shared artifact",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );

    const { Route } = await import("../src/routes/al.$publicId");
    render(<Route.component />);

    await waitFor(() => expect(screen.getByTitle("Artifact content")).toBeInTheDocument());
    await waitFor(() => expect(liveUpdates.lastInput?.onRevoked).toBeTypeOf("function"));

    await act(async () => {
      liveUpdates.lastInput?.onRevoked?.();
    });

    await waitFor(() => expect(screen.queryByTitle("Artifact content")).not.toBeInTheDocument());
    expect(screen.getByText("Not found.")).toBeInTheDocument();
    expect(screen.getByText(/invalid, expired, locked/i)).toBeInTheDocument();
  });

  it("sends claim-code attribution when resolving an Access Link", async () => {
    window.history.replaceState({}, "", "/al/pub_1?claim_code=clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD#signed-blob");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/access-links/resolve") {
        return new Response(JSON.stringify({ render_mode: "html", iframe_src: contentIframeSrc }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { Route } = await import("../src/routes/al.$publicId");
    render(<Route.component />);

    await waitFor(() => expect(screen.getByTitle("Artifact content")).toBeInTheDocument());
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      public_id: "pub_1",
      blob: "signed-blob",
      claim_code: "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD",
    });
  });

  it("shows Access Link metadata from the floating agent-paste.sh bar and resets hidden state on reload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/access-links/resolve") {
          return new Response(
            JSON.stringify({
              render_mode: "html",
              iframe_src: contentIframeSrc,
              title: "Shared artifact",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );

    const { Route } = await import("../src/routes/al.$publicId");
    const view = render(<Route.component />);

    await waitFor(() => expect(screen.getByTitle("Artifact content")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Open agent-paste.sh artifact details" }));

    expect(screen.getByRole("region", { name: "Artifact metadata" })).toBeInTheDocument();
    expect(screen.getByText("Shared artifact")).toBeInTheDocument();
    expect(screen.getByText("Render mode")).toBeInTheDocument();
    expect(screen.getByText("html")).toBeInTheDocument();
    expect(screen.getByText("Access link")).toBeInTheDocument();
    expect(screen.getByText("pub_1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide toggle" }));
    expect(screen.queryByRole("button", { name: "Open agent-paste.sh artifact details" })).not.toBeInTheDocument();

    view.unmount();
    render(<Route.component />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open agent-paste.sh artifact details" })).toBeInTheDocument(),
    );
  });

  it("clears the dashboard artifact iframe when a revoke refetch reports lockdown", async () => {
    const { Route } = await import("../src/routes/_authed.artifacts.$artifactId");

    // First load: live, viewer shown. After revoke, the invalidation-driven
    // refetch returns a locked-down artifact, which hides the viewer.
    getArtifactFn
      .mockResolvedValueOnce({ data: artifactDetailRow(), empty: false, error: null })
      .mockResolvedValue({ data: artifactDetailRow({ lockdown: true }), empty: false, error: null });

    renderWithQuery(<Route.component />);

    await waitFor(() => expect(screen.getByTitle("Artifact content")).toBeInTheDocument());
    await waitFor(() => expect(liveUpdates.lastInput?.onRevoked).toBeTypeOf("function"));

    await act(async () => {
      liveUpdates.lastInput?.onRevoked?.();
    });

    await waitFor(() => expect(screen.queryByTitle("Artifact content")).not.toBeInTheDocument());
    expect(screen.queryByText("Published viewer")).not.toBeInTheDocument();
    expect(screen.getByText("Latest revision")).toBeInTheDocument();
    expect(screen.getByText("Locked down")).toBeInTheDocument();
  });

  it("clears the dashboard artifact iframe on platform_lockdown even when the refetch still reports the viewer", async () => {
    const { Route } = await import("../src/routes/_authed.artifacts.$artifactId");

    // A platform lockdown blocks content at the edge without touching the
    // artifact row, so every refetch keeps reporting lockdown:false + viewer.
    // The local revoked flag must hide the shell anyway.
    getArtifactFn.mockResolvedValue({ data: artifactDetailRow(), empty: false, error: null });

    renderWithQuery(<Route.component />);

    await waitFor(() => expect(screen.getByTitle("Artifact content")).toBeInTheDocument());
    await waitFor(() => expect(liveUpdates.lastInput?.onRevoked).toBeTypeOf("function"));

    await act(async () => {
      liveUpdates.lastInput?.onRevoked?.("platform_lockdown");
    });

    await waitFor(() => expect(screen.queryByTitle("Artifact content")).not.toBeInTheDocument());
    expect(screen.getByText("No published viewer.")).toBeInTheDocument();
  });

  it("updates the dashboard artifact iframe when a publish event refetches a new revision", async () => {
    const { Route } = await import("../src/routes/_authed.artifacts.$artifactId");

    const nextIframeSrc = "https://content.test/v/art.rev2/index.html";
    getArtifactFn.mockResolvedValue({ data: artifactDetailRow(), empty: false, error: null });

    renderWithQuery(<Route.component />);

    await waitFor(() => expect(screen.getByTitle("Artifact content")).toHaveAttribute("src", contentIframeSrc));
    await waitFor(() => expect(liveUpdates.lastInput?.onPointer).toBeTypeOf("function"));

    await act(async () => {
      liveUpdates.lastInput?.onPointer?.({ revision_id: "rev_next", iframe_src: nextIframeSrc, render_mode: "html" });
    });

    await waitFor(() => expect(screen.getByTitle("Artifact content")).toHaveAttribute("src", nextIframeSrc));
  });

  it("keeps the live iframe when the post-publish metadata refetch times out", async () => {
    const { Route } = await import("../src/routes/_authed.artifacts.$artifactId");

    const nextIframeSrc = "https://content.test/v/art.rev2/index.html";
    getArtifactFn.mockResolvedValueOnce({ data: artifactDetailRow(), empty: false, error: null }).mockResolvedValue({
      data: null,
      empty: true,
      error: { status: 0, code: "network_error", message: "The operation was aborted due to timeout" },
    });

    renderWithQuery(<Route.component />);

    await waitFor(() => expect(screen.getByTitle("Artifact content")).toHaveAttribute("src", contentIframeSrc));
    await waitFor(() => expect(liveUpdates.lastInput?.onPointer).toBeTypeOf("function"));

    await act(async () => {
      liveUpdates.lastInput?.onPointer?.({ revision_id: "rev_next", iframe_src: nextIframeSrc, render_mode: "html" });
    });

    await waitFor(() => expect(getArtifactFn).toHaveBeenCalledTimes(2));
    expect(screen.getByTitle("Artifact content")).toHaveAttribute("src", nextIframeSrc);
    expect(screen.queryByText("Couldn't load this artifact")).not.toBeInTheDocument();
  });
});
