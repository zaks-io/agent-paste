import type { McpScope } from "@agent-paste/contracts";
import { deriveMcpIdempotencyKey } from "@agent-paste/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as publishChain from "./publish-chain.js";
import { callMcpTool } from "./tools.js";

vi.mock("./publish-chain.js", () => ({
  runTextPublishChain: vi.fn(),
}));

const auth = { tokenSub: "user_01", bearerToken: "token-read" };

function whoamiBodyFor(scopes: readonly McpScope[]) {
  return {
    workspace_member: { id: "mem_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", email: "user@example.com" },
    workspace: { id: "550e8400-e29b-41d4-a716-446655440000", name: "Personal", created_at: "2026-05-20T12:00:00.000Z" },
    scopes: [...scopes],
  };
}

const whoamiBody = whoamiBodyFor(["read", "write", "share"]);

/**
 * Mock api service binding. The pre-flight scope gate (ADR 0079) calls `mcp.whoami`
 * before the real route, so answer that path with a whoami body carrying `grantedScopes`,
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

function publishedBody(input: { title?: string; accessLink?: string | null } = {}) {
  return {
    title: input.title ?? "Note",
    ...(input.accessLink === null ? {} : { access_link_url: input.accessLink ?? "https://share.example/al_01" }),
    expires_at: "2026-12-01T00:00:00.000Z",
    upload_stats: {
      total_files: 1,
      total_bytes: 5,
      uploaded_files: 1,
      uploaded_bytes: 5,
      reused_files: 0,
      reused_bytes: 0,
    },
  };
}

function expectNoPublishDiagnosticFields(body: unknown) {
  expect(body).not.toHaveProperty("artifact_id");
  expect(body).not.toHaveProperty("revision_id");
  expect(body).not.toHaveProperty("artifact_url");
  expect(body).not.toHaveProperty("revision_content_url");
  expect(body).not.toHaveProperty("agent_view_url");
}

/** The Nth real route request (skipping the pre-flight `mcp.whoami` gate call). */
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
    const api = apiMock(["write"], Response.json(deleteBody));
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

  it("delegates publish_artifact to the text publish chain without Share Link creation by default", async () => {
    const published = publishedBody({ accessLink: null });
    vi.mocked(publishChain.runTextPublishChain).mockResolvedValue({ ok: true, status: 200, body: published });
    const result = await callMcpTool("publish_artifact", { title: "Note", body: "hello", render_mode: "text" }, auth, {
      api: apiMock(["write", "read"]),
      upload: { fetch: vi.fn() },
      bearerToken: "token-write-read",
      jsonRpcId: 42,
    });
    expect(result).toEqual({ ok: true, result: published });
    if (result.ok) {
      expectNoPublishDiagnosticFields(result.result);
    }
    expect(publishChain.runTextPublishChain).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Note", share: false }),
      expect.any(Object),
    );
  });

  it("scopes derived publish idempotency keys to the payload, not just the json rpc id", async () => {
    vi.mocked(publishChain.runTextPublishChain).mockResolvedValue({ ok: true, status: 200, body: publishedBody() });
    const callWith = async (body: string) => {
      await callMcpTool("publish_artifact", { title: "Note", body, render_mode: "text" }, auth, {
        api: apiMock(["write", "read", "share"]),
        upload: { fetch: vi.fn() },
        bearerToken: "token-all",
        jsonRpcId: 1,
      });
      const calls = vi.mocked(publishChain.runTextPublishChain).mock.calls;
      return (calls[calls.length - 1]?.[1] as { idempotencyKey: string }).idempotencyKey;
    };

    const first = await callWith("session one");
    const retry = await callWith("session one");
    const nextSession = await callWith("session two");

    expect(retry).toBe(first);
    expect(nextSession).not.toBe(first);
  });

  it("prefers an explicit idempotency_key over the derived key", async () => {
    vi.mocked(publishChain.runTextPublishChain).mockResolvedValue({ ok: true, status: 200, body: publishedBody() });
    await callMcpTool(
      "publish_artifact",
      { title: "Note", body: "hello", render_mode: "text", idempotency_key: "client-key-123" },
      auth,
      { api: apiMock(["write", "read", "share"]), upload: { fetch: vi.fn() }, bearerToken: "token-all", jsonRpcId: 1 },
    );
    expect(publishChain.runTextPublishChain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: "client-key-123" }),
    );
  });

  it("requires share scope when publish_artifact explicitly requests a Share Link", async () => {
    const result = await callMcpTool(
      "publish_artifact",
      { title: "Note", body: "hello", render_mode: "text", share: true },
      auth,
      {
        api: apiMock(["write", "read"]),
        upload: { fetch: vi.fn() },
        bearerToken: "token-write-read",
        jsonRpcId: 42,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("insufficient_scope");
    }
    expect(publishChain.runTextPublishChain).not.toHaveBeenCalled();
  });

  it("allows publish_artifact to opt out of Access Link creation explicitly", async () => {
    const published = publishedBody({ accessLink: null });
    vi.mocked(publishChain.runTextPublishChain).mockResolvedValue({ ok: true, status: 200, body: published });
    const result = await callMcpTool(
      "publish_artifact",
      { title: "Note", body: "hello", render_mode: "text", share: false },
      auth,
      {
        api: apiMock(["write", "read"]),
        upload: { fetch: vi.fn() },
        bearerToken: "token-write-read",
        jsonRpcId: 42,
      },
    );
    expect(result).toEqual({ ok: true, result: published });
    if (result.ok) {
      expect(result.result).not.toHaveProperty("access_link_url");
      expectNoPublishDiagnosticFields(result.result);
    }
    expect(publishChain.runTextPublishChain).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Note", share: false }),
      expect.any(Object),
    );
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

  it("creates and mints a share link", async () => {
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const api = apiMock(
      ["read", "share"],
      Response.json({
        id: "al_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        type: "share",
        artifact_id: artifactId,
        revision_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
      }),
      Response.json({ url: "https://share.example/al" }),
    );
    const result = await callMcpTool("create_share_link", { artifact_id: artifactId }, auth, {
      api,
      upload,
      bearerToken: "token-share",
      jsonRpcId: 7,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toMatchObject({ url: "https://share.example/al" });
    }
    const createRequest = routeCall(api, 0);
    expect(createRequest.headers.get("idempotency-key")).toBe(
      deriveMcpIdempotencyKey({
        tokenSub: "user_01",
        jsonRpcId: 7,
        toolName: "create_share_link",
        toolArgs: { artifact_id: artifactId },
      }),
    );
    const mintRequest = routeCall(api, 1);
    expect(mintRequest.url).toBe("https://agent-paste.internal/v1/access-links/al_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/mint");
    expect(mintRequest.headers.get("idempotency-key")).toBeNull();
    await expect(mintRequest.text()).resolves.toBe("");
  });

  it("delegates add_revision to the text publish chain without Access Link sharing by default", async () => {
    const published = publishedBody({ title: "Revision", accessLink: null });
    vi.mocked(publishChain.runTextPublishChain).mockResolvedValue({ ok: true, status: 200, body: published });
    const result = await callMcpTool(
      "add_revision",
      {
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        body: "next",
        render_mode: "text",
      },
      auth,
      { api: apiMock(["write", "read"]), upload: { fetch: vi.fn() }, bearerToken: "token-write-read", jsonRpcId: 43 },
    );
    expect(result).toEqual({ ok: true, result: published });
    if (result.ok) {
      expectNoPublishDiagnosticFields(result.result);
    }
    expect(publishChain.runTextPublishChain).toHaveBeenCalledWith(
      expect.objectContaining({ artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", share: false }),
      expect.any(Object),
    );
  });

  it("creates a revision link", async () => {
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const api = apiMock(
      ["read", "share"],
      Response.json({
        id: "al_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0",
        type: "revision",
        artifact_id: artifactId,
        revision_id: revisionId,
        created_at: "2026-01-01T00:00:00.000Z",
      }),
      Response.json({ url: "https://share.example/rev" }),
    );
    const result = await callMcpTool(
      "create_revision_link",
      { artifact_id: artifactId, revision_id: revisionId },
      auth,
      { api, upload, bearerToken: "token-share", jsonRpcId: 8 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toMatchObject({ url: "https://share.example/rev" });
    }
    const createRequest = routeCall(api, 0);
    expect(createRequest.headers.get("idempotency-key")).toBe(
      deriveMcpIdempotencyKey({
        tokenSub: "user_01",
        jsonRpcId: 8,
        toolName: "create_revision_link",
        toolArgs: { artifact_id: artifactId, revision_id: revisionId },
      }),
    );
    const mintRequest = routeCall(api, 1);
    expect(mintRequest.url).toBe("https://agent-paste.internal/v1/access-links/al_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0/mint");
    expect(mintRequest.headers.get("idempotency-key")).toBeNull();
    await expect(mintRequest.text()).resolves.toBe("");
  });

  it("lists and revokes access links", async () => {
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const linkId = "al_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const api = apiMock(
      ["read", "share"],
      Response.json({
        artifact_id: artifactId,
        items: [
          {
            id: linkId,
            type: "share",
            artifact_id: artifactId,
            revision_id: null,
            created_at: "2026-01-01T00:00:00.000Z",
            expires_at: null,
            revoked_at: null,
          },
        ],
      }),
      Response.json({ access_link_id: linkId, revoked_at: "2026-01-02T00:00:00.000Z" }),
    );
    const listResult = await callMcpTool("list_access_links", { artifact_id: artifactId }, auth, {
      api,
      upload,
      bearerToken: "token-share",
    });
    expect(listResult.ok).toBe(true);
    const revokeResult = await callMcpTool("revoke_access_link", { access_link_id: linkId }, auth, {
      api,
      upload,
      bearerToken: "token-share",
    });
    expect(revokeResult.ok).toBe(true);
  });

  it("rejects update_display_metadata calls that include description", async () => {
    const result = await callMcpTool(
      "update_display_metadata",
      {
        artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        description: "not supported",
      },
      auth,
      { api: apiMock(["write"]), upload, bearerToken: "token-write" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_params");
    }
  });

  it("updates display metadata through the API binding", async () => {
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
    const metadata = { title: "Renamed", description: null };
    const api = apiMock(["write"], Response.json(metadata));
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
