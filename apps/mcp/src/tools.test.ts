import type { McpScope } from "@agent-paste/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callMcpTool } from "./tools.js";

const auth = { tokenSub: "user_01", bearerToken: "token-read" };

const ARTIFACT_ID = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const REVISION_ID = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const UPLOAD_SESSION_ID = "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

/**
 * An upload binding that answers the publish sequence: uploadSessions.create
 * (one upload_required file) then uploadSessions.finalize. The PUT itself goes
 * through the global fetch (stubbed per test).
 */
function uploadMockForPublish() {
  return {
    fetch: vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname.endsWith("/finalize")) {
        return Response.json({
          upload_session_id: UPLOAD_SESSION_ID,
          artifact_id: ARTIFACT_ID,
          revision_id: REVISION_ID,
          status: "draft",
          title: "Note",
          entrypoint: "content.txt",
          file_count: 1,
          size_bytes: 5,
        });
      }
      // Echo the entrypoint the request asked to upload so the shared module can
      // match the returned target back to its in-memory file. Clone so the test
      // can still read the original request body.
      const body = (await request.clone().json()) as { entrypoint: string };
      return Response.json({
        upload_session_id: UPLOAD_SESSION_ID,
        artifact_id: ARTIFACT_ID,
        revision_id: REVISION_ID,
        status: "pending",
        expires_at: "2026-12-01T00:00:00.000Z",
        files: [
          {
            status: "upload_required",
            path: body.entrypoint,
            put_url: "https://upload.example/put",
            required_headers: { "content-length": "5" },
            expires_at: "2026-12-01T00:00:00.000Z",
          },
        ],
      });
    }),
  };
}

/** The server publish response with the one stable Artifact link. */
function serverPublishResult() {
  return {
    artifact_id: ARTIFACT_ID,
    revision_id: REVISION_ID,
    title: "Note",
    url: "https://0123456789abcdef0123456789abcdef.agent-paste.link/",
    expires_at: "2026-12-01T00:00:00.000Z",
  };
}

/** The base Agent View add_revision reads first to preserve title + entrypoint. */
function baseAgentView(over: Record<string, unknown> = {}) {
  return {
    artifact_id: ARTIFACT_ID,
    revision_id: REVISION_ID,
    title: "Original Title",
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2026-12-01T00:00:00.000Z",
    entrypoint: "content.txt",
    url: "https://0123456789abcdef0123456789abcdef.agent-paste.link/",
    revision_content_url: "https://content.example/v/token/content.txt",
    files: [
      { path: "content.txt", size_bytes: 4, content_type: "text/plain", url: "https://content.example/content.txt" },
    ],
    safety_warnings: [],
    bundle: { status: "disabled" },
    ...over,
  };
}

/** SHA-256 hex of a string, matching the engine's content addressing. */
async function sha256HexOf(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The base file content add_revision reads to diff the new body against. */
async function baseFileContent(body: string) {
  return {
    path: "content.txt",
    sha256: await sha256HexOf(body),
    size_bytes: new TextEncoder().encode(body).byteLength,
    content_type: "text/plain",
    is_binary: false,
    body,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function whoamiBodyFor(scopes: readonly McpScope[]) {
  return {
    workspace_member: { id: "mem_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", email: "user@example.com" },
    workspace: { id: "550e8400-e29b-41d4-a716-446655440000", name: "Personal", created_at: "2026-05-20T12:00:00.000Z" },
    scopes: [...scopes],
  };
}

const whoamiBody = whoamiBodyFor(["read", "publish", "admin"]);

/**
 * Mock api service binding. Multi-step tools pre-flight through `mcp.whoami`
 * before the real routes, so answer that path with a body carrying `scopes`,
 * and answer every other path sequentially from `routeResponses`.
 */
function apiMock(grantedScopes: readonly McpScope[], ...routeResponses: Response[]) {
  let next = 0;
  return {
    fetch: vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname.endsWith("/mcp/whoami")) {
        return Response.json(whoamiBodyFor(grantedScopes));
      }
      const response = routeResponses[next];
      next += 1;
      return response ?? new Response("not found", { status: 404 });
    }),
  };
}

/** The Nth real route request, excluding any multi-step `mcp.whoami` pre-flight. */
function routeCall(api: ReturnType<typeof apiMock>, index: number): Request {
  const routeRequests = api.fetch.mock.calls
    .map((call) => call[0] as Request)
    .filter((request) => !new URL(request.url).pathname.endsWith("/mcp/whoami"));
  return routeRequests[index] as Request;
}

describe("callMcpTool", () => {
  const upload = { fetch: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects invalid tool call params", async () => {
    const result = await callMcpTool("not-a-tool", {}, auth, {
      api: { fetch: vi.fn() },
      upload,
      bearerToken: auth.bearerToken,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_params");
    }
  });

  it("rejects tools when the member's granted scopes are insufficient", async () => {
    const api = apiMock(["read"]);
    const result = await callMcpTool("publish_artifact", { title: "t", body: "b", render_mode: "text" }, auth, {
      api,
      upload,
      bearerToken: auth.bearerToken,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("insufficient_scope");
    }
  });

  it("returns list_artifacts results from the API binding", async () => {
    const listBody = {
      data: [],
      page_info: { next_cursor: null, has_more: false },
    };
    const api = apiMock(["read"], Response.json(listBody));
    const result = await callMcpTool("list_artifacts", {}, auth, { api, upload, bearerToken: "token-read" });
    expect(result).toEqual({ ok: true, result: listBody });
    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(new URL((api.fetch.mock.calls[0]?.[0] as Request).url).pathname).toBe("/v1/artifacts");
  });

  it("returns whoami results from the API binding", async () => {
    const api = {
      fetch: vi.fn(async () => Response.json(whoamiBody)),
    };
    const result = await callMcpTool("whoami", {}, auth, { api, upload, bearerToken: auth.bearerToken });
    expect(result).toEqual({ ok: true, result: whoamiBody });
  });

  it("surfaces API forwarding failures", async () => {
    const api = {
      fetch: vi.fn(async () => Response.json({ error: { code: "forbidden", message: "forbidden" } }, { status: 403 })),
    };
    const result = await callMcpTool("whoami", {}, auth, { api, upload, bearerToken: auth.bearerToken });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("insufficient_scope");
    }
  });

  it("deletes an artifact through the API binding", async () => {
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const deleteBody = { artifact_id: artifactId, deleted_at: "2026-01-01T00:00:00.000Z" };
    const api = apiMock(["publish"], Response.json(deleteBody));
    const result = await callMcpTool("delete_artifact", { artifact_id: artifactId }, auth, {
      api,
      upload,
      bearerToken: "token-write",
    });
    expect(result).toEqual({ ok: true, result: deleteBody });
  });

  it("reads an artifact agent view from the API binding", async () => {
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const agentView = {
      artifact_id: artifactId,
      revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      title: "Demo",
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-12-01T00:00:00.000Z",
      entrypoint: "index.md",
      url: "https://0123456789abcdef0123456789abcdef.agent-paste.link/",
      revision_content_url: "https://view.example",
      files: [
        {
          path: "index.md",
          size_bytes: 5,
          content_type: "text/markdown",
          url: "https://content.example/index.md",
        },
      ],
      safety_warnings: [],
      bundle: { status: "pending", retry_after_seconds: 30 },
    };
    const api = apiMock(["read"], Response.json(agentView));
    const result = await callMcpTool("read_artifact", { artifact_id: artifactId }, auth, {
      api,
      upload,
      bearerToken: auth.bearerToken,
    });
    expect(result).toEqual({ ok: true, result: agentView });
  });

  it("read_file forwards path + revision_id and returns the file content", async () => {
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const fileContent = {
      path: "index.md",
      sha256: "a".repeat(64),
      size_bytes: 6,
      content_type: "text/markdown",
      is_binary: false,
      body: "hello\n",
    };
    const api = apiMock(["read"], Response.json(fileContent));
    const result = await callMcpTool(
      "read_file",
      { artifact_id: artifactId, path: "index.md", revision_id: revisionId },
      auth,
      { api, upload, bearerToken: auth.bearerToken },
    );
    expect(result).toEqual({ ok: true, result: fileContent });
    const url = new URL(routeCall(api, 0).url);
    expect(url.pathname.endsWith(`/artifacts/${artifactId}/file-content`)).toBe(true);
    expect(url.searchParams.get("path")).toBe("index.md");
    expect(url.searchParams.get("revision_id")).toBe(revisionId);
  });

  it("read_file omits revision_id from the query when not provided", async () => {
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const fileContent = {
      path: "index.md",
      sha256: "a".repeat(64),
      size_bytes: 6,
      content_type: "text/markdown",
      is_binary: false,
      body: "hello\n",
    };
    const api = apiMock(["read"], Response.json(fileContent));
    const result = await callMcpTool("read_file", { artifact_id: artifactId, path: "index.md" }, auth, {
      api,
      upload,
      bearerToken: auth.bearerToken,
    });
    expect(result).toEqual({ ok: true, result: fileContent });
    const url = new URL(routeCall(api, 0).url);
    expect(url.searchParams.get("path")).toBe("index.md");
    expect(url.searchParams.has("revision_id")).toBe(false);
  });

  it("publish_artifact returns the stable Artifact link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const api = apiMock(["publish", "read"], Response.json(serverPublishResult()));
    const result = await callMcpTool("publish_artifact", { title: "Note", body: "hello", render_mode: "text" }, auth, {
      api,
      upload: uploadMockForPublish(),
      bearerToken: "token-write-read",
      jsonRpcId: 42,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toMatchObject({
        artifact_id: ARTIFACT_ID,
        revision_id: REVISION_ID,
        url: "https://0123456789abcdef0123456789abcdef.agent-paste.link/",
        title: "Note",
      });
      expect(result.result).not.toHaveProperty("shared");
    }
    // Publish is content-only => the publish request body is empty (no Share Link minted).
    expect(await routeCall(api, 0).text()).toBe("");
  });

  it("rejects a share input on publish_artifact (no public concept in publish)", async () => {
    const upload = uploadMockForPublish();
    const result = await callMcpTool(
      "publish_artifact",
      { title: "Note", body: "hello", render_mode: "text", share: true },
      auth,
      { api: apiMock(["publish", "read", "admin"]), upload, bearerToken: "token-all", jsonRpcId: 42 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_params");
    }
    expect(upload.fetch).not.toHaveBeenCalled();
  });

  it("scopes derived publish idempotency keys to the payload, not just the json rpc id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const keyFor = async (body: string) => {
      const upload = uploadMockForPublish();
      await callMcpTool("publish_artifact", { title: "Note", body, render_mode: "text" }, auth, {
        api: apiMock(["publish", "read", "admin"], Response.json(serverPublishResult())),
        upload,
        bearerToken: "token-all",
        jsonRpcId: 1,
      });
      const createCall = upload.fetch.mock.calls[0]?.[0] as Request;
      return createCall.headers.get("idempotency-key");
    };

    const first = await keyFor("session one");
    const retry = await keyFor("session one");
    const nextSession = await keyFor("session two");

    expect(retry).toBe(first);
    expect(nextSession).not.toBe(first);
  });

  it("prefers an explicit idempotency_key over the derived key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const upload = uploadMockForPublish();
    await callMcpTool(
      "publish_artifact",
      { title: "Note", body: "hello", render_mode: "text", idempotency_key: "client-key-123" },
      auth,
      {
        api: apiMock(["publish", "read", "admin"], Response.json(serverPublishResult())),
        upload,
        bearerToken: "token-all",
        jsonRpcId: 1,
      },
    );
    const createCall = upload.fetch.mock.calls[0]?.[0] as Request;
    expect(createCall.headers.get("idempotency-key")).toBe("client-key-123");
  });

  it("maps an upload forward failure to the corresponding MCP error code", async () => {
    const upload = {
      fetch: vi.fn(async () => Response.json({ error: { code: "forbidden", message: "forbidden" } }, { status: 403 })),
    };
    const result = await callMcpTool("publish_artifact", { title: "Note", body: "hello", render_mode: "text" }, auth, {
      api: apiMock(["publish", "read"]),
      upload,
      bearerToken: "token-write-read",
      jsonRpcId: 42,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("insufficient_scope");
    }
  });

  it("skips the PUT for a reused upload target and still returns the Artifact link", async () => {
    const putFetch = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", putFetch);
    const upload = {
      fetch: vi.fn(async (request: Request) => {
        if (new URL(request.url).pathname.endsWith("/finalize")) {
          return Response.json({
            upload_session_id: UPLOAD_SESSION_ID,
            artifact_id: ARTIFACT_ID,
            revision_id: REVISION_ID,
            status: "draft",
            title: "Note",
            entrypoint: "content.txt",
            file_count: 1,
            size_bytes: 5,
          });
        }
        const body = (await request.clone().json()) as { entrypoint: string };
        return Response.json({
          upload_session_id: UPLOAD_SESSION_ID,
          artifact_id: ARTIFACT_ID,
          revision_id: REVISION_ID,
          status: "pending",
          expires_at: "2026-12-01T00:00:00.000Z",
          files: [{ status: "reused", path: body.entrypoint }],
        });
      }),
    };
    const result = await callMcpTool("publish_artifact", { title: "Note", body: "hello", render_mode: "text" }, auth, {
      api: apiMock(["publish", "read"], Response.json(serverPublishResult())),
      upload,
      bearerToken: "token-write-read",
      jsonRpcId: 42,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toMatchObject({ url: "https://0123456789abcdef0123456789abcdef.agent-paste.link/" });
      expect(result.result).not.toHaveProperty("shared");
    }
    // Reused target => the signed PUT is never issued.
    expect(putFetch).not.toHaveBeenCalled();
  });

  it("lists revisions for an artifact", async () => {
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const revisions = {
      artifact_id: artifactId,
      items: [],
      page_info: { next_cursor: null, has_more: false },
    };
    const api = apiMock(["read"], Response.json(revisions));
    const result = await callMcpTool("list_revisions", { artifact_id: artifactId }, auth, {
      api,
      upload,
      bearerToken: auth.bearerToken,
    });
    expect(result).toEqual({ ok: true, result: revisions });
  });

  it("add_revision reads the base, publishes under it, and preserves the artifact title", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const api = apiMock(
      ["publish", "read"],
      Response.json(baseAgentView()),
      Response.json(await baseFileContent("old body")),
      Response.json(serverPublishResult()),
    );
    const upload = uploadMockForPublish();
    const result = await callMcpTool(
      "add_revision",
      { artifact_id: ARTIFACT_ID, body: "next body", render_mode: "text" },
      auth,
      { api, upload, bearerToken: "token-write-read", jsonRpcId: 43 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toMatchObject({ url: "https://0123456789abcdef0123456789abcdef.agent-paste.link/" });
    }
    // The create-session request targets the existing artifact, publishes under the base
    // revision, and carries the BASE title — not the literal "Revision" the old code wrote.
    const createCall = upload.fetch.mock.calls[0]?.[0] as Request;
    const createBody = (await createCall.json()) as { artifact_id: string; base_revision_id: string; title: string };
    expect(createBody.artifact_id).toBe(ARTIFACT_ID);
    expect(createBody.base_revision_id).toBe(REVISION_ID);
    expect(createBody.title).toBe("Original Title");
  });

  it("add_revision is a no-op when the new body matches the stored bytes, echoing the stable link", async () => {
    const publishPut = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", publishPut);
    const api = apiMock(
      ["publish", "read"],
      Response.json(baseAgentView()),
      Response.json(await baseFileContent("same body")),
    );
    const upload = uploadMockForPublish();
    const result = await callMcpTool(
      "add_revision",
      { artifact_id: ARTIFACT_ID, body: "same body", render_mode: "text" },
      auth,
      { api, upload, bearerToken: "token-write-read", jsonRpcId: 44 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toMatchObject({
        title: "Original Title",
        url: "https://0123456789abcdef0123456789abcdef.agent-paste.link/",
      });
    }
    // Byte-identical body: no upload session is ever created.
    expect(upload.fetch).not.toHaveBeenCalled();
  });

  it("multi_edit applies literal edits to the base file and publishes under the base revision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const api = apiMock(
      ["publish", "read"],
      Response.json(baseAgentView()),
      Response.json(await baseFileContent("old body")),
      Response.json(serverPublishResult()),
    );
    const upload = uploadMockForPublish();
    const result = await callMcpTool(
      "multi_edit",
      { artifact_id: ARTIFACT_ID, path: "content.txt", edits: [{ old_string: "old", new_string: "new" }] },
      auth,
      { api, upload, bearerToken: "token-write-read", jsonRpcId: 51 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toMatchObject({ url: "https://0123456789abcdef0123456789abcdef.agent-paste.link/" });
    }
    // Publishes under the existing artifact + base revision, preserving the base title.
    const createBody = (await (upload.fetch.mock.calls[0]?.[0] as Request).json()) as {
      artifact_id: string;
      base_revision_id: string;
      title: string;
    };
    expect(createBody.artifact_id).toBe(ARTIFACT_ID);
    expect(createBody.base_revision_id).toBe(REVISION_ID);
    expect(createBody.title).toBe("Original Title");
  });

  it("multi_edit is a no-op when the edits reproduce the stored bytes, echoing the stable link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const api = apiMock(
      ["publish", "read"],
      Response.json(baseAgentView()),
      Response.json(await baseFileContent("same body")),
    );
    const upload = uploadMockForPublish();
    const result = await callMcpTool(
      "multi_edit",
      // Replace "same" with "same": the result equals the stored bytes.
      { artifact_id: ARTIFACT_ID, path: "content.txt", edits: [{ old_string: "same", new_string: "same" }] },
      auth,
      { api, upload, bearerToken: "token-write-read", jsonRpcId: 52 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toMatchObject({
        title: "Original Title",
        url: "https://0123456789abcdef0123456789abcdef.agent-paste.link/",
      });
    }
    expect(upload.fetch).not.toHaveBeenCalled();
  });

  it("multi_edit surfaces a non-matching edit as a client invalid_request, not internal_error", async () => {
    const api = apiMock(
      ["publish", "read"],
      Response.json(baseAgentView()),
      Response.json(await baseFileContent("old body")),
    );
    const upload = uploadMockForPublish();
    const result = await callMcpTool(
      "multi_edit",
      { artifact_id: ARTIFACT_ID, path: "content.txt", edits: [{ old_string: "absent", new_string: "x" }] },
      auth,
      { api, upload, bearerToken: "token-write-read", jsonRpcId: 53 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_request");
      expect(result.error.message).toContain("not_found");
    }
    // The edit never matched, so no upload session is created.
    expect(upload.fetch).not.toHaveBeenCalled();
  });

  it("rejects update_display_metadata calls that include description", async () => {
    const result = await callMcpTool(
      "update_display_metadata",
      {
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        description: "not supported",
      },
      auth,
      { api: apiMock(["publish"]), upload, bearerToken: "token-write" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_params");
    }
  });

  it("updates display metadata through the API binding", async () => {
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const metadata = { title: "Renamed", description: null };
    const api = apiMock(["publish"], Response.json(metadata));
    const result = await callMcpTool("update_display_metadata", { artifact_id: artifactId, title: "Renamed" }, auth, {
      api,
      upload,
      bearerToken: "token-write",
    });
    expect(result).toEqual({ ok: true, result: metadata });
  });

  it("maps rate_limited_actor from forwarded API errors", async () => {
    const api = {
      fetch: vi.fn(async () =>
        Response.json({ error: { code: "rate_limited_actor", message: "rate_limited_actor" } }, { status: 429 }),
      ),
    };
    const result = await callMcpTool("whoami", {}, auth, { api, upload, bearerToken: auth.bearerToken });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited_actor");
    }
  });

  it("returns internal_error when whoami payload fails validation", async () => {
    const api = {
      fetch: vi.fn(async () => Response.json({ workspace_member: { id: "bad" } })),
    };
    const result = await callMcpTool("whoami", {}, auth, { api, upload, bearerToken: auth.bearerToken });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("internal_error");
    }
  });
});
