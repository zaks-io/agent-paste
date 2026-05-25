import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  requestId: "req_test",
  env: {
    API_BASE_URL: "https://api.example.test/",
    API: undefined as { fetch(request: Request): Promise<Response> } | undefined,
  },
}));

vi.mock("../src/server/runtime", () => ({
  getRequestId: () => runtime.requestId,
  getWebEnv: () => runtime.env,
}));

import { ApiError, apiFetch, apiFetchOrEmpty } from "../src/server/api-client";

describe("web api client", () => {
  beforeEach(() => {
    runtime.requestId = "req_test";
    runtime.env.API_BASE_URL = "https://api.example.test/";
    runtime.env.API = undefined;
    vi.restoreAllMocks();
  });

  it("sends JSON, request id, and bearer headers through the API service binding", async () => {
    const requests: Request[] = [];
    runtime.env.API = {
      async fetch(request) {
        requests.push(request);
        return Response.json({ ok: true });
      },
    };

    await expect(
      apiFetch("/v1/web/settings", {
        method: "PATCH",
        accessToken: "workos-token",
        body: JSON.stringify({ workspace_name: "Demo" }),
      }),
    ).resolves.toEqual({ ok: true });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.example.test/v1/web/settings");
    expect(requests[0]?.headers.get("accept")).toBe("application/json");
    expect(requests[0]?.headers.get("x-request-id")).toBe("req_test");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer workos-token");
    expect(requests[0]?.headers.get("content-type")).toBe("application/json");
  });

  it("resolves paths without a leading slash and preserves explicit content type", async () => {
    const requests: Request[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({ ok: true });
    });

    await apiFetch("v1/web/keys", {
      method: "POST",
      headers: { "content-type": "application/vnd.agent-paste+json" },
      body: "{}",
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(requests[0]?.url).toBe("https://api.example.test/v1/web/keys");
    expect(requests[0]?.headers.get("content-type")).toBe("application/vnd.agent-paste+json");
  });

  it("returns undefined for 204 responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiFetch("/v1/web/keys/key_1/revoke")).resolves.toBeUndefined();
  });

  it("throws invalid_response for non-JSON API responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 502 }));

    await expect(apiFetch("/v1/web/workspace")).rejects.toMatchObject({
      status: 502,
      code: "invalid_response",
      requestId: "req_test",
    });
  });

  it("throws ApiError values from API error envelopes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { error: { code: "invalid_request", message: "bad input", request_id: "req_upstream" } },
        { status: 400 },
      ),
    );

    await expect(apiFetch("/v1/web/settings")).rejects.toMatchObject({
      status: 400,
      code: "invalid_request",
      message: "bad input",
      requestId: "req_upstream",
    });
  });

  it("wraps successful, absent, API-error, and network outcomes for loaders", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ workspace: { name: "Demo" } }))
      .mockResolvedValueOnce(Response.json({ error: { code: "not_found", message: "missing" } }, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({ error: { code: "internal_error", message: "boom", request_id: "req_api" } }, { status: 500 }),
      )
      .mockRejectedValueOnce(new Error("network down"));

    await expect(apiFetchOrEmpty("/v1/web/workspace")).resolves.toEqual({
      data: { workspace: { name: "Demo" } },
      empty: false,
      error: null,
    });
    await expect(apiFetchOrEmpty("/v1/web/artifacts/art_missing")).resolves.toEqual({
      data: null,
      empty: true,
      error: null,
    });
    await expect(apiFetchOrEmpty("/v1/web/audit")).resolves.toEqual({
      data: null,
      empty: false,
      error: { status: 500, code: "internal_error", message: "boom", requestId: "req_api" },
    });
    await expect(apiFetchOrEmpty("/v1/web/keys")).resolves.toEqual({
      data: null,
      empty: false,
      error: { status: 0, code: "network_error", message: "network down", requestId: "req_test" },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("treats 501 responses as empty loader data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: { code: "not_implemented", message: "deferred" } }, { status: 501 }),
    );

    await expect(apiFetchOrEmpty("/v1/access-links")).resolves.toEqual({ data: null, empty: true, error: null });
  });

  it("identifies direct ApiError instances", () => {
    expect(new ApiError(418, "teapot", "short").status).toBe(418);
  });
});
