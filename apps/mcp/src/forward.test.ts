import { describe, expect, it, vi } from "vitest";
import { forwardToApi, forwardToUpload, putSignedUploadFile } from "./forward.js";

const bearer = "mcp-test-token";

describe("forwardToApi", () => {
  it("forwards idempotency keys on mutating requests", async () => {
    const api = {
      fetch: vi.fn(async () => Response.json({ ok: true })),
    };
    await forwardToApi({
      api,
      method: "POST",
      path: "/v1/example",
      bearerToken: bearer,
      body: "{}",
      idempotencyKey: "idem-123",
    });
    const request = api.fetch.mock.calls[0]?.[0] as Request;
    expect(request.headers.get("idempotency-key")).toBe("idem-123");
  });

  it("returns JSON bodies for successful responses", async () => {
    const api = {
      fetch: vi.fn(async () => Response.json({ ok: true }, { headers: { "content-type": "application/json" } })),
    };

    const result = await forwardToApi({
      api,
      method: "GET",
      path: "/v1/mcp/whoami",
      bearerToken: bearer,
    });

    expect(result).toEqual({ ok: true, status: 200, body: { ok: true } });
    expect(api.fetch).toHaveBeenCalledOnce();
    const request = api.fetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://agent-paste.internal/v1/mcp/whoami");
    expect(request.headers.get("authorization")).toBe(`Bearer ${bearer}`);
  });

  it("skips JSON parsing for non-JSON responses", async () => {
    const api = {
      fetch: vi.fn(async () => new Response("plain", { status: 200, headers: { "content-type": "text/plain" } })),
    };

    const result = await forwardToApi({ api, method: "GET", path: "/v1/healthz", bearerToken: bearer });
    expect(result).toEqual({ ok: true, status: 200, body: null });
  });

  it("maps fetch failures to database_unavailable", async () => {
    const api = { fetch: vi.fn(async () => Promise.reject(new Error("network"))) };
    const result = await forwardToApi({ api, method: "GET", path: "/v1/mcp/whoami", bearerToken: bearer });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("database_unavailable");
    }
  });

  it("treats invalid JSON bodies as null on error responses", async () => {
    const api = {
      fetch: vi.fn(
        async () => new Response("not-json", { status: 500, headers: { "content-type": "application/json" } }),
      ),
    };
    const result = await forwardToApi({ api, method: "GET", path: "/v1/mcp/whoami", bearerToken: bearer });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_request");
    }
  });

  it("maps auth envelope codes to MCP protocol errors", async () => {
    for (const [apiCode, mcpCode] of [
      ["not_authenticated", "invalid_token"],
      ["invalid_auth", "invalid_token"],
      ["forbidden", "insufficient_scope"],
    ] as const) {
      const api = {
        fetch: vi.fn(async () =>
          Response.json(
            { error: { code: apiCode, message: apiCode } },
            { status: 401, headers: { "content-type": "application/json" } },
          ),
        ),
      };
      const result = await forwardToApi({ api, method: "GET", path: "/v1/mcp/whoami", bearerToken: bearer });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(mcpCode);
      }
    }
  });

  it("maps structured API errors with metadata", async () => {
    const api = {
      fetch: vi.fn(async () =>
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
    const result = await forwardToApi({ api, method: "GET", path: "/v1/artifacts/x", bearerToken: bearer });
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
      fetch: vi.fn(async () => new Response(null, { status: 401 })),
    };
    const forbidden = {
      fetch: vi.fn(async () => new Response(null, { status: 403 })),
    };
    const badRequest = {
      fetch: vi.fn(async () => new Response(null, { status: 400 })),
    };

    const unauth = await forwardToApi({
      api: unauthorized,
      method: "GET",
      path: "/v1/mcp/whoami",
      bearerToken: bearer,
    });
    const forbid = await forwardToApi({ api: forbidden, method: "GET", path: "/v1/mcp/whoami", bearerToken: bearer });
    const invalid = await forwardToApi({ api: badRequest, method: "GET", path: "/v1/mcp/whoami", bearerToken: bearer });

    expect(unauth.ok).toBe(false);
    if (!unauth.ok) expect(unauth.error.code).toBe("invalid_token");
    if (!forbid.ok) expect(forbid.error.code).toBe("insufficient_scope");
    if (!invalid.ok) expect(invalid.error.code).toBe("invalid_request");
  });

  it("sets JSON content-type for POST bodies when absent", async () => {
    const api = {
      fetch: vi.fn(async (request: Request) => {
        expect(request.method).toBe("POST");
        expect(request.headers.get("content-type")).toBe("application/json");
        return Response.json({ ok: true });
      }),
    };

    await forwardToApi({
      api,
      method: "POST",
      path: "/v1/example",
      bearerToken: bearer,
      body: JSON.stringify({ example: true }),
    });
  });

  it("preserves caller-provided content-type headers", async () => {
    const api = {
      fetch: vi.fn(async (request: Request) => {
        expect(request.headers.get("content-type")).toBe("application/custom+json");
        return Response.json({ ok: true });
      }),
    };

    await forwardToApi({
      api,
      method: "POST",
      path: "/v1/example",
      bearerToken: bearer,
      headers: { "content-type": "application/custom+json" },
      body: "{}",
    });
  });
});

describe("forwardToUpload", () => {
  it("maps upload fetch failures to database_unavailable", async () => {
    const upload = { fetch: vi.fn(async () => Promise.reject(new Error("network"))) };
    const result = await forwardToUpload({
      upload,
      method: "POST",
      path: "/v1/upload-sessions",
      bearerToken: bearer,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("database_unavailable");
    }
  });

  it("forwards upload requests with idempotency keys", async () => {
    const upload = {
      fetch: vi.fn(async () => Response.json({ upload_session_id: "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" })),
    };
    const result = await forwardToUpload({
      upload,
      method: "POST",
      path: "/v1/upload-sessions",
      bearerToken: bearer,
      body: "{}",
      idempotencyKey: "idem-1",
    });
    expect(result.ok).toBe(true);
    const request = upload.fetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://agent-paste.internal/v1/upload-sessions");
    expect(request.headers.get("idempotency-key")).toBe("idem-1");
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
