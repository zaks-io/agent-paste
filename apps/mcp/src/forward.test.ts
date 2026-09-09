import { describe, expect, it, vi } from "vitest";
import {
  buildRoutePath,
  forwardToApi,
  forwardToApiRoute,
  forwardToUpload,
  forwardToUploadRoute,
  MAX_MCP_FILE_CONTENT_RESPONSE_BYTES,
  MAX_MCP_FORWARDED_RESPONSE_BYTES,
  putSignedUploadFile,
} from "./forward.js";

const subject = "user_01";

describe("forwardToApi", () => {
  it("resolves method and path from route contracts", async () => {
    const api = {
      fetchMcp: vi.fn(async () => Response.json({ ok: true })),
    };

    await forwardToApiRoute({
      api,
      routeId: "revisions.list",
      params: { artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" },
      query: { cursor: "next cursor" },
      tokenSub: subject,
    });

    const request = api.fetchMcp.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe("GET");
    expect(request.url).toBe(
      "https://agent-paste.internal/v1/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/revisions?cursor=next+cursor",
    );
    expect(api.fetchMcp.mock.calls[0]?.[1]).toBe(subject);
    expect(api.fetchMcp.mock.calls[0]?.[2]).toBe("revisions.list");
    expect(request.headers.has("authorization")).toBe(false);
  });

  it("forwards idempotency keys on mutating requests", async () => {
    const api = {
      fetchMcp: vi.fn(async () => Response.json({ ok: true })),
    };
    await forwardToApi({
      api,
      method: "POST",
      path: "/v1/artifacts/art_1/revisions/rev_1/publish",
      routeId: "revisions.publish",
      tokenSub: subject,
      body: "{}",
      idempotencyKey: "idem-123",
    });
    const request = api.fetchMcp.mock.calls[0]?.[0] as Request;
    expect(request.headers.get("idempotency-key")).toBe("idem-123");
  });

  it("returns JSON bodies for successful responses", async () => {
    const api = {
      fetchMcp: vi.fn(async () => Response.json({ ok: true }, { headers: { "content-type": "application/json" } })),
    };

    const result = await forwardToApi({
      api,
      method: "GET",
      path: "/v1/mcp/whoami",
      routeId: "mcp.whoami",
      tokenSub: subject,
    });

    expect(result).toEqual({ ok: true, status: 200, body: { ok: true } });
    expect(api.fetchMcp).toHaveBeenCalledOnce();
    const request = api.fetchMcp.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://agent-paste.internal/v1/mcp/whoami");
    expect(request.headers.has("authorization")).toBe(false);
  });

  it("skips JSON parsing for non-JSON responses", async () => {
    const api = {
      fetchMcp: vi.fn(async () => new Response("plain", { status: 200, headers: { "content-type": "text/plain" } })),
    };

    const result = await forwardToApi({
      api,
      method: "GET",
      path: "/v1/mcp/whoami",
      routeId: "mcp.whoami",
      tokenSub: subject,
    });
    expect(result).toEqual({ ok: true, status: 200, body: null });
  });

  it("maps fetch failures to database_unavailable", async () => {
    const api = { fetchMcp: vi.fn(async () => Promise.reject(new Error("network"))) };
    const result = await forwardToApi({
      api,
      method: "GET",
      path: "/v1/mcp/whoami",
      routeId: "mcp.whoami",
      tokenSub: subject,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("database_unavailable");
    }
  });

  it("treats invalid JSON bodies as null on error responses", async () => {
    const api = {
      fetchMcp: vi.fn(
        async () => new Response("not-json", { status: 500, headers: { "content-type": "application/json" } }),
      ),
    };
    const result = await forwardToApi({
      api,
      method: "GET",
      path: "/v1/mcp/whoami",
      routeId: "mcp.whoami",
      tokenSub: subject,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_request");
    }
  });

  it("rejects oversized JSON responses from private service bindings", async () => {
    const api = {
      fetchMcp: vi.fn(
        async () =>
          new Response(JSON.stringify({ data: "x".repeat(512 * 1024) }), {
            headers: { "content-type": "application/json" },
          }),
      ),
    };
    const result = await forwardToApi({
      api,
      method: "GET",
      path: "/v1/mcp/whoami",
      routeId: "mcp.whoami",
      tokenSub: subject,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "internal_error", message: "upstream_response_too_large" },
    });
  });

  it("preserves the 10 MiB file-content contract while bounding its encoded response", async () => {
    expect(MAX_MCP_FILE_CONTENT_RESPONSE_BYTES).toBeGreaterThanOrEqual(10 * 1024 * 1024 * 6);
    const body = "x".repeat(MAX_MCP_FORWARDED_RESPONSE_BYTES);
    const api = {
      fetchMcp: vi.fn(async () => Response.json({ body }, { headers: { "content-type": "application/json" } })),
    };

    const result = await forwardToApi({
      api,
      method: "GET",
      path: "/v1/artifacts/art_1/files/content?path=index.txt",
      routeId: "artifacts.fileContent",
      tokenSub: subject,
    });

    expect(result).toMatchObject({ ok: true, body: { body } });
  });

  it("maps auth envelope codes to MCP protocol errors", async () => {
    for (const [apiCode, mcpCode] of [
      ["not_authenticated", "invalid_token"],
      ["invalid_auth", "invalid_token"],
      ["forbidden", "insufficient_scope"],
    ] as const) {
      const api = {
        fetchMcp: vi.fn(async () =>
          Response.json(
            { error: { code: apiCode, message: apiCode } },
            { status: 401, headers: { "content-type": "application/json" } },
          ),
        ),
      };
      const result = await forwardToApi({
        api,
        method: "GET",
        path: "/v1/mcp/whoami",
        routeId: "mcp.whoami",
        tokenSub: subject,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(mcpCode);
      }
    }
  });

  it("maps structured API errors with metadata", async () => {
    const api = {
      fetchMcp: vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "artifact_not_found",
              message: "artifact_not_found",
              request_id: "req_123",
              docs: "https://docs.example.test/errors",
            },
          },
          { status: 404, headers: { "content-type": "application/json" } },
        ),
      ),
    };
    const result = await forwardToApi({
      api,
      method: "GET",
      path: "/v1/mcp/whoami",
      routeId: "mcp.whoami",
      tokenSub: subject,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "artifact_not_found",
        requestId: "req_123",
        docs: "https://docs.example.test/errors",
      });
    }
  });

  it("maps bare HTTP status codes when the envelope is missing", async () => {
    const unauthorized = {
      fetchMcp: vi.fn(async () => new Response(null, { status: 401 })),
    };
    const forbidden = {
      fetchMcp: vi.fn(async () => new Response(null, { status: 403 })),
    };
    const badRequest = {
      fetchMcp: vi.fn(async () => new Response(null, { status: 400 })),
    };

    const unauth = await forwardToApi({
      api: unauthorized,
      method: "GET",
      path: "/v1/mcp/whoami",
      routeId: "mcp.whoami",
      tokenSub: subject,
    });
    const forbid = await forwardToApi({
      api: forbidden,
      method: "GET",
      path: "/v1/mcp/whoami",
      routeId: "mcp.whoami",
      tokenSub: subject,
    });
    const invalid = await forwardToApi({
      api: badRequest,
      method: "GET",
      path: "/v1/mcp/whoami",
      routeId: "mcp.whoami",
      tokenSub: subject,
    });

    expect(unauth.ok).toBe(false);
    if (!unauth.ok) expect(unauth.error.code).toBe("invalid_token");
    if (!forbid.ok) expect(forbid.error.code).toBe("insufficient_scope");
    if (!invalid.ok) expect(invalid.error.code).toBe("invalid_request");
  });

  it("sets JSON content-type for POST bodies when absent", async () => {
    const api = {
      fetchMcp: vi.fn(async (request: Request) => {
        expect(request.method).toBe("POST");
        expect(request.headers.get("content-type")).toBe("application/json");
        return Response.json({ ok: true });
      }),
    };

    await forwardToApi({
      api,
      method: "POST",
      path: "/v1/artifacts/art_1/revisions/rev_1/publish",
      routeId: "revisions.publish",
      tokenSub: subject,
      body: JSON.stringify({ example: true }),
    });
  });

  it("preserves caller-provided content-type headers", async () => {
    const api = {
      fetchMcp: vi.fn(async (request: Request) => {
        expect(request.headers.get("content-type")).toBe("application/custom+json");
        return Response.json({ ok: true });
      }),
    };

    await forwardToApi({
      api,
      method: "POST",
      path: "/v1/artifacts/art_1/revisions/rev_1/publish",
      routeId: "revisions.publish",
      tokenSub: subject,
      headers: { "content-type": "application/custom+json" },
      body: "{}",
    });
  });
});

describe("forwardToUpload", () => {
  it("resolves upload method and path from route contracts", async () => {
    const upload = {
      fetchMcp: vi.fn(async () => Response.json({ ok: true })),
    };

    await forwardToUploadRoute({
      upload,
      routeId: "uploadSessions.finalize",
      params: { upload_session_id: "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" },
      tokenSub: subject,
      idempotencyKey: "idem-finalize",
    });

    const request = upload.fetchMcp.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://agent-paste.internal/v1/upload-sessions/upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/finalize");
    expect(request.headers.get("idempotency-key")).toBe("idem-finalize");
  });

  it("maps upload fetch failures to database_unavailable", async () => {
    const upload = { fetchMcp: vi.fn(async () => Promise.reject(new Error("network"))) };
    const result = await forwardToUpload({
      upload,
      method: "POST",
      path: "/v1/upload-sessions",
      routeId: "uploadSessions.create",
      tokenSub: subject,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("database_unavailable");
    }
  });

  it("forwards upload requests with idempotency keys", async () => {
    const upload = {
      fetchMcp: vi.fn(async () => Response.json({ upload_session_id: "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" })),
    };
    const result = await forwardToUpload({
      upload,
      method: "POST",
      path: "/v1/upload-sessions",
      routeId: "uploadSessions.create",
      tokenSub: subject,
      body: "{}",
      idempotencyKey: "idem-1",
    });
    expect(result.ok).toBe(true);
    const request = upload.fetchMcp.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://agent-paste.internal/v1/upload-sessions");
    expect(request.headers.get("idempotency-key")).toBe("idem-1");
  });
});

describe("buildRoutePath", () => {
  it("encodes path params and query params", () => {
    expect(
      buildRoutePath("/v1/artifacts/{artifact_id}/revisions/{revision_id}", {
        artifact_id: "art with spaces",
        revision_id: "rev/with/slashes",
      }),
    ).toBe("/v1/artifacts/art%20with%20spaces/revisions/rev%2Fwith%2Fslashes");
    expect(buildRoutePath("/v1/artifacts", {}, { cursor: "next cursor", empty: undefined })).toBe(
      "/v1/artifacts?cursor=next+cursor",
    );
  });

  it("rejects missing path params", () => {
    expect(() => buildRoutePath("/v1/artifacts/{artifact_id}", {})).toThrow("Missing route path param: artifact_id");
  });
});

describe("putSignedUploadFile", () => {
  it("uploads bytes to the signed URL", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await putSignedUploadFile({
      putUrl: "https://storage.example/put",
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain; charset=utf-8",
    });

    expect(result).toEqual({ ok: true, status: 200, body: null });
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("maps PUT network failures to storage_unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("network"))),
    );
    const result = await putSignedUploadFile({
      putUrl: "https://storage.example/put",
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain; charset=utf-8",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("storage_unavailable");
    }
    vi.unstubAllGlobals();
  });

  it("maps failed PUT responses to upload_incomplete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const result = await putSignedUploadFile({
      putUrl: "https://storage.example/put",
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain; charset=utf-8",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("upload_incomplete");
    }
    vi.unstubAllGlobals();
  });
});
