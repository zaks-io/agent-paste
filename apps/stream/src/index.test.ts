import { STREAM_INTERNAL_SECRET_HEADER } from "@agent-paste/worker-runtime";
import { describe, expect, it, vi } from "vitest";
import { type Env, handleRequest } from "./index.js";
import { createMemoryArtifactLiveNamespace, resetMemoryArtifactLiveHubs } from "./memory-artifact-live.js";

const pointer = {
  revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  iframe_src: "https://content.test/v/art.rev/index.html",
  render_mode: "html" as const,
  title: "Demo",
};

function envWithApi(apiFetch: Env["API"]["fetch"]): Env {
  const api = { fetch: apiFetch };
  return {
    API: api,
    ARTIFACT_LIVE: createMemoryArtifactLiveNamespace({ api }) as unknown as Env["ARTIFACT_LIVE"],
  };
}

describe("stream worker", () => {
  it("serves health checks", async () => {
    const response = await handleRequest(new Request("https://stream.test/healthz"), envWithApi(vi.fn()));
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
  });

  it("returns not_found for unknown routes", async () => {
    const response = await handleRequest(new Request("https://stream.test/unknown"), envWithApi(vi.fn()));
    expect(response.status).toBe(404);
  });

  it("connects access-link clients when authorization succeeds", async () => {
    resetMemoryArtifactLiveHubs();
    const apiFetch = vi.fn(async (request: Request) => {
      expect(request.headers.get(STREAM_INTERNAL_SECRET_HEADER)).toBe("stream-internal-secret");
      return Response.json({
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        audience: "share",
        pointer,
      });
    });
    const response = await handleRequest(
      new Request("https://stream.test/v1/live/access-links/0123456789ABCDEF", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blob: "signed" }),
      }),
      { ...envWithApi(apiFetch), STREAM_INTERNAL_SECRET: "stream-internal-secret" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("returns not_found for invalid access-link bodies or failed authorization", async () => {
    const badBody = await handleRequest(
      new Request("https://stream.test/v1/live/access-links/0123456789ABCDEF", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      envWithApi(vi.fn()),
    );
    expect(badBody.status).toBe(404);

    const denied = await handleRequest(
      new Request("https://stream.test/v1/live/access-links/0123456789ABCDEF", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blob: "signed" }),
      }),
      envWithApi(vi.fn(async () => new Response("nope", { status: 404 }))),
    );
    expect(denied.status).toBe(404);
  });

  it("connects dashboard clients when bearer authorization succeeds", async () => {
    resetMemoryArtifactLiveHubs();
    const apiFetch = vi.fn(async (request: Request) => {
      expect(request.headers.get("authorization")).toBe("Bearer workos");
      expect(request.headers.get(STREAM_INTERNAL_SECRET_HEADER)).toBe("stream-internal-secret");
      return Response.json({
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        audience: "dashboard",
        pointer,
      });
    });
    const response = await handleRequest(
      new Request("https://stream.test/v1/live/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", {
        method: "GET",
        headers: { authorization: "Bearer workos" },
      }),
      { ...envWithApi(apiFetch), STREAM_INTERNAL_SECRET: "stream-internal-secret" },
    );
    expect(response.status).toBe(200);
  });

  it("returns not_found for dashboard routes without authorization or when denied", async () => {
    const missingAuth = await handleRequest(
      new Request("https://stream.test/v1/live/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", { method: "GET" }),
      envWithApi(vi.fn()),
    );
    expect(missingAuth.status).toBe(404);

    const denied = await handleRequest(
      new Request("https://stream.test/v1/live/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", {
        method: "GET",
        headers: { authorization: "Bearer workos" },
      }),
      envWithApi(vi.fn(async () => new Response("nope", { status: 404 }))),
    );
    expect(denied.status).toBe(404);
  });
});
