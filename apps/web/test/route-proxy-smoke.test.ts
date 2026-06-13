// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
}));

const state = vi.hoisted(() => ({
  auth: { user: { email: "user@example.com" }, accessToken: "workos-token" } as {
    user: { email: string } | null;
    accessToken?: string;
  },
  env: {
    STREAM_BASE_URL: "https://stream.test",
    WEB_BASE_URL: "https://app.test",
  },
  apiFetch: vi.fn(),
}));

// TanStack Start context: route handlers dynamically import authkit, which calls
// getGlobalStartContext() against AsyncLocalStorage. Other web route tests mock
// this; without it, parallel vitest can resolve the real module and throw.
vi.mock("@tanstack/react-start", () => ({
  getGlobalStartContext: () => ({
    auth: () =>
      state.auth.user
        ? {
            ...state.auth,
            sessionId: "session_1",
            claims: {},
          }
        : { user: null },
  }),
}));

vi.mock("../src/server/authkit", () => ({
  getServerAuth: () => state.auth,
}));

vi.mock("../src/server/runtime", () => ({
  getWebEnv: () => state.env,
}));

vi.mock("../src/server/api-client", () => ({
  apiFetch: (...args: unknown[]) => state.apiFetch(...args),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

// Static imports (not beforeAll dynamic imports): vitest hoists vi.mock above
// these, so handlers still see mocked auth/runtime. Module graph transform +
// coverage instrumentation can exceed the default 10s hookTimeout on cold CI
// runners; file-load import time is not subject to that hook budget. AP-320.
import * as artifactLiveRoute from "../src/routes/api/live/artifacts/$artifactId";
import * as accessLinkLiveRoute from "../src/routes/api/live/access-links/$publicId";
import * as accessLinkResolveRoute from "../src/routes/api/access-links/resolve";

describe("web API proxy routes", () => {
  beforeEach(() => {
    state.auth = { user: { email: "user@example.com" }, accessToken: "workos-token" };
    state.apiFetch.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("proxies artifact live streams when authed", async () => {
    const upstream = new Response("event: ping\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    vi.mocked(fetch).mockResolvedValue(upstream);

    const { Route } = artifactLiveRoute;
    const response = await Route.server.handlers.GET({
      request: new Request("https://app.test/api/live/artifacts/art_1"),
      params: { artifactId: "art_1" },
    });

    expect(fetch).toHaveBeenCalledWith("https://stream.test/v1/live/artifacts/art_1", {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        authorization: "Bearer workos-token",
      },
      signal: expect.any(AbortSignal),
    });
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("event: ping\n\n");
  });

  it("percent-encodes artifact ids in the upstream URL", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 404 }));

    const { Route } = artifactLiveRoute;
    await Route.server.handlers.GET({
      request: new Request("https://app.test/api/live/artifacts/..%2F..%2Fadmin"),
      params: { artifactId: "../../admin?x=1#f" },
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://stream.test/v1/live/artifacts/..%2F..%2Fadmin%3Fx%3D1%23f",
      expect.any(Object),
    );
  });

  it("returns not_found for unauthenticated artifact live streams", async () => {
    state.auth = { user: null };
    const { Route } = artifactLiveRoute;
    const response = await Route.server.handlers.GET({
      request: new Request("https://app.test/api/live/artifacts/art_1"),
      params: { artifactId: "art_1" },
    });
    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("proxies access-link live streams", async () => {
    const upstream = new Response("event: revoked\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    vi.mocked(fetch).mockResolvedValue(upstream);

    const { Route } = accessLinkLiveRoute;
    const response = await Route.server.handlers.POST({
      request: new Request("https://app.test/api/live/access-links/pub_1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fragment: "sig" }),
      }),
      params: { publicId: "pub_1" },
    });

    expect(fetch).toHaveBeenCalledWith("https://stream.test/v1/live/access-links/pub_1", {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ fragment: "sig" }),
      signal: expect.any(AbortSignal),
    });
    expect(response.status).toBe(200);
  });

  it("percent-encodes access-link public ids in the upstream URL", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 404 }));

    const { Route } = accessLinkLiveRoute;
    await Route.server.handlers.POST({
      request: new Request("https://app.test/api/live/access-links/..%2Fadmin", {
        method: "POST",
        body: "{}",
      }),
      params: { publicId: "../admin?x=1#f" },
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://stream.test/v1/live/access-links/..%2Fadmin%3Fx%3D1%23f",
      expect.any(Object),
    );
  });

  it("resolves access links through the API client", async () => {
    state.apiFetch.mockResolvedValue({ artifact_id: "art_1" });
    const { Route } = accessLinkResolveRoute;
    const response = await Route.server.handlers.POST({
      request: new Request("https://app.test/api/access-links/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ public_id: "pub_1", fragment: "sig" }),
      }),
    });

    expect(state.apiFetch).toHaveBeenCalledWith("/v1/access-links/resolve", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ public_id: "pub_1", fragment: "sig" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ artifact_id: "art_1" });
  });
});
