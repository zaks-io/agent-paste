// @ts-nocheck
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  loaderData: undefined as unknown,
  params: { artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", publicId: "pub_1" },
}));

const liveUpdates = vi.hoisted(() => ({
  lastInput: null as {
    onPointer?: (pointer: { iframe_src: string }) => void;
    onRevoked?: () => void;
  } | null,
  close: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    <TConfig extends Record<string, unknown>>(config: TConfig) => ({
      ...config,
      useLoaderData: () => state.loaderData,
      useParams: () => state.params,
    }),
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

vi.mock("../src/lib/live-updates", () => ({
  connectLiveUpdates: (input: typeof liveUpdates.lastInput & Record<string, unknown>) => {
    liveUpdates.lastInput = input;
    return { close: liveUpdates.close };
  },
}));

const contentIframeSrc = "https://content.test/v/art.rev/index.html";

function artifactDetailRow() {
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
  };
}

describe("viewer live-update revocation", () => {
  beforeEach(() => {
    liveUpdates.lastInput = null;
    liveUpdates.close.mockReset();
    state.params = { artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", publicId: "pub_1" };
    window.location.hash = "#signed-blob";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = "";
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
    expect(liveUpdates.lastInput?.onRevoked).toBeTypeOf("function");

    liveUpdates.lastInput?.onRevoked?.();

    await waitFor(() => expect(screen.queryByTitle("Artifact content")).not.toBeInTheDocument());
    expect(screen.getByText("Not found.")).toBeInTheDocument();
    expect(screen.getByText(/invalid, expired, locked/i)).toBeInTheDocument();
  });

  it("clears the dashboard artifact iframe when live updates are revoked", async () => {
    const { Route } = await import("../src/routes/_authed.artifacts.$artifactId");

    state.loaderData = { data: artifactDetailRow(), empty: false, error: null };
    render(<Route.component />);

    await waitFor(() => expect(screen.getByTitle("Artifact content")).toBeInTheDocument());
    expect(liveUpdates.lastInput?.onRevoked).toBeTypeOf("function");

    liveUpdates.lastInput?.onRevoked?.();

    await waitFor(() => expect(screen.queryByTitle("Artifact content")).not.toBeInTheDocument());
    expect(screen.queryByText("Published viewer")).not.toBeInTheDocument();
    expect(screen.getByText("Latest revision")).toBeInTheDocument();
  });
});
