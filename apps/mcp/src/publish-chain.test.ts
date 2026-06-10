import { IdempotencyKey, mcpPublishAccessLinkIdempotencyKey } from "@agent-paste/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as forward from "./forward.js";
import { runTextPublishChain } from "./publish-chain.js";

vi.mock("./forward.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./forward.js")>();
  return {
    ...actual,
    forwardToUploadRoute: vi.fn(),
    forwardToApiRoute: vi.fn(),
    putSignedUploadFile: vi.fn(),
  };
});

const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const uploadSessionId = "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const expiresAt = "2026-12-01T00:00:00.000Z";
const shareLinkId = "al_01HZY7Q8X9Y2S3T4V5W6X7Y8ZB";

const deps = {
  api: { fetch: vi.fn() },
  upload: { fetch: vi.fn() },
  bearerToken: "oauth-token",
  idempotencyKey: IdempotencyKey.parse("mcp:user:1:publish_artifact"),
};

const publishBody = {
  artifact_id: artifactId,
  revision_id: revisionId,
  title: "Note",
  artifact_url: "https://app.example/artifacts/art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  revision_content_url: "https://content.example/v/token/index.md",
  agent_view_url: "https://agent-view.example",
  expires_at: expiresAt,
  bundle: { status: "pending" as const, retry_after_seconds: 30 },
};

function mockUploadChain(entrypoint: string, sizeBytes: number) {
  vi.mocked(forward.forwardToUploadRoute)
    .mockResolvedValueOnce({
      ok: true,
      status: 201,
      body: {
        upload_session_id: uploadSessionId,
        artifact_id: artifactId,
        revision_id: revisionId,
        status: "pending",
        expires_at: expiresAt,
        files: [
          {
            status: "upload_required",
            path: entrypoint,
            put_url: "https://signed/put",
            required_headers: entrypoint.endsWith(".md") ? { "x-test": "1" } : {},
            expires_at: expiresAt,
          },
        ],
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        upload_session_id: uploadSessionId,
        artifact_id: artifactId,
        revision_id: revisionId,
        status: "draft",
        title: "Note",
        entrypoint,
        file_count: 1,
        size_bytes: sizeBytes,
      },
    });
  vi.mocked(forward.putSignedUploadFile).mockResolvedValue({ ok: true, status: 200, body: null });
}

function mockPublish() {
  vi.mocked(forward.forwardToApiRoute).mockResolvedValueOnce({ ok: true, status: 200, body: publishBody });
}

describe("runTextPublishChain", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("runs create, upload put, finalize, and publish for markdown", async () => {
    mockUploadChain("index.md", 7);
    mockPublish();

    const result = await runTextPublishChain(
      { title: "Note", body: "# hello", render_mode: "markdown", share: false },
      deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toMatchObject({
        artifact_id: artifactId,
        revision_id: revisionId,
        artifact_url: publishBody.artifact_url,
        agent_view_url: "https://agent-view.example",
        upload_stats: {
          total_files: 1,
          total_bytes: 7,
          uploaded_files: 1,
          uploaded_bytes: 7,
          reused_files: 0,
          reused_bytes: 0,
        },
      });
      expect(result.body).not.toHaveProperty("revision_link_url");
      expect(result.body).not.toHaveProperty("share_link_url");
    }
    expect(forward.putSignedUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "text/markdown; charset=utf-8",
      }),
    );
    expect(vi.mocked(forward.forwardToApiRoute).mock.calls).toHaveLength(1);
    expect(vi.mocked(forward.forwardToApiRoute).mock.calls[0]?.[0]).toMatchObject({ routeId: "revisions.publish" });
  });

  it("skips PUT for reused upload targets and reports reused bytes", async () => {
    vi.mocked(forward.forwardToUploadRoute)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: {
          upload_session_id: uploadSessionId,
          artifact_id: artifactId,
          revision_id: revisionId,
          status: "pending",
          expires_at: expiresAt,
          files: [{ status: "reused", path: "content.txt" }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          upload_session_id: uploadSessionId,
          artifact_id: artifactId,
          revision_id: revisionId,
          status: "draft",
          title: "Note",
          entrypoint: "content.txt",
          file_count: 1,
          size_bytes: 5,
        },
      });
    mockPublish();

    const result = await runTextPublishChain({ title: "Note", body: "hello", render_mode: "text" }, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.upload_stats).toEqual({
        total_files: 1,
        total_bytes: 5,
        uploaded_files: 0,
        uploaded_bytes: 0,
        reused_files: 1,
        reused_bytes: 5,
      });
    }
    expect(forward.putSignedUploadFile).not.toHaveBeenCalled();
  });

  it("forwards derived share idempotency keys when publish with share is retried", async () => {
    // Mocks return a fresh access-link row on every create; this file only asserts key
    // propagation on the share create forward. Duplicate-row prevention is covered in
    // packages/db/src/member-mcp-operations.test.ts.
    const shareUrl = "https://share.example/al_01";
    const shareKey = mcpPublishAccessLinkIdempotencyKey(deps.idempotencyKey);
    let shareCreateInvocations = 0;

    vi.mocked(forward.forwardToUploadRoute).mockImplementation(async (input) => {
      if (input.routeId === "uploadSessions.create") {
        return {
          ok: true,
          status: 201,
          body: {
            upload_session_id: uploadSessionId,
            artifact_id: artifactId,
            revision_id: revisionId,
            status: "pending",
            expires_at: expiresAt,
            files: [
              {
                status: "upload_required",
                path: "content.txt",
                put_url: "https://signed/put",
                required_headers: {},
                expires_at: expiresAt,
              },
            ],
          },
        };
      }
      if (input.routeId === "uploadSessions.finalize") {
        return {
          ok: true,
          status: 200,
          body: {
            upload_session_id: uploadSessionId,
            artifact_id: artifactId,
            revision_id: revisionId,
            status: "draft",
            title: "Note",
            entrypoint: "content.txt",
            file_count: 1,
            size_bytes: 5,
          },
        };
      }
      return {
        ok: false,
        error: { code: "internal_error", message: "internal_error", jsonRpcCode: -32000, httpStatus: 500 },
      };
    });
    vi.mocked(forward.putSignedUploadFile).mockResolvedValue({ ok: true, status: 200, body: null });
    vi.mocked(forward.forwardToApiRoute).mockImplementation(async (input) => {
      if (input.routeId === "revisions.publish") {
        return { ok: true, status: 200, body: publishBody };
      }
      if (input.routeId === "accessLinks.create") {
        if (input.idempotencyKey === shareKey) {
          shareCreateInvocations += 1;
          expect(JSON.parse(input.body as string)).toEqual({ type: "share" });
          return {
            ok: true,
            status: 201,
            body: {
              id: shareLinkId,
              type: "share",
              artifact_id: artifactId,
              revision_id: null,
              created_at: expiresAt,
            },
          };
        }
      }
      if (input.routeId === "accessLinks.mint") {
        return { ok: true, status: 200, body: { url: shareUrl } };
      }
      return {
        ok: false,
        error: { code: "internal_error", message: "internal_error", jsonRpcCode: -32000, httpStatus: 500 },
      };
    });

    const input = { title: "Note", body: "hello", render_mode: "text" as const, share: true };
    const first = await runTextPublishChain(input, deps);
    const second = await runTextPublishChain(input, deps);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.body).toMatchObject({
        access_link_url: shareUrl,
        artifact_url: publishBody.artifact_url,
      });
      expect(second.body).toMatchObject({
        access_link_url: shareUrl,
        artifact_url: publishBody.artifact_url,
      });
      expect(first.body).not.toHaveProperty("revision_link_url");
      expect(first.body).not.toHaveProperty("share_link_url");
      expect(second.body).not.toHaveProperty("revision_link_url");
      expect(second.body).not.toHaveProperty("share_link_url");
    }
    expect(shareCreateInvocations).toBe(2);
  });

  it("reuses an active Share Link when add_revision requests a link", async () => {
    const shareUrl = "https://share.example/al_01";
    const addRevisionDeps = {
      ...deps,
      idempotencyKey: IdempotencyKey.parse("mcp:user:1:add_revision"),
    };
    mockUploadChain("content.txt", 7);
    vi.mocked(forward.forwardToApiRoute)
      .mockResolvedValueOnce({ ok: true, status: 200, body: { ...publishBody, title: "Revision" } })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          artifact_id: artifactId,
          items: [
            {
              id: shareLinkId,
              type: "share",
              artifact_id: artifactId,
              revision_id: null,
              created_at: expiresAt,
              expires_at: null,
              revoked_at: null,
            },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { url: shareUrl } });

    const input = {
      artifact_id: artifactId,
      body: "updated",
      render_mode: "text" as const,
      share: true,
    };
    const result = await runTextPublishChain(input, addRevisionDeps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toMatchObject({ access_link_url: shareUrl });
      expect(result.body).not.toHaveProperty("revision_link_url");
      expect(result.body).not.toHaveProperty("share_link_url");
    }
    expect(vi.mocked(forward.forwardToApiRoute).mock.calls.map((call) => call[0].routeId)).toEqual([
      "revisions.publish",
      "accessLinks.list",
      "accessLinks.mint",
    ]);
    expect(vi.mocked(forward.forwardToApiRoute).mock.calls[2]?.[0]).toMatchObject({
      routeId: "accessLinks.mint",
      params: { access_link_id: shareLinkId },
    });
  });

  it("creates a Share Link during add_revision when no active Share Link exists", async () => {
    const shareUrl = "https://share.example/al_01";
    const addRevisionDeps = {
      ...deps,
      idempotencyKey: IdempotencyKey.parse("mcp:user:1:add_revision"),
    };
    const shareKey = mcpPublishAccessLinkIdempotencyKey(addRevisionDeps.idempotencyKey);
    mockUploadChain("content.txt", 7);
    vi.mocked(forward.forwardToApiRoute)
      .mockResolvedValueOnce({ ok: true, status: 200, body: { ...publishBody, title: "Revision" } })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { artifact_id: artifactId, items: [] } })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: {
          id: shareLinkId,
          type: "share",
          artifact_id: artifactId,
          revision_id: null,
          created_at: expiresAt,
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { url: shareUrl } });

    const result = await runTextPublishChain(
      {
        artifact_id: artifactId,
        body: "updated",
        render_mode: "text",
        share: true,
      },
      addRevisionDeps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toMatchObject({ access_link_url: shareUrl });
      expect(result.body).not.toHaveProperty("share_link_url");
    }
    const shareCreateCall = vi.mocked(forward.forwardToApiRoute).mock.calls[2]?.[0];
    expect(shareCreateCall).toMatchObject({
      routeId: "accessLinks.create",
      idempotencyKey: shareKey,
    });
    expect(JSON.parse(shareCreateCall?.body as string)).toEqual({ type: "share" });
  });

  it("mints a share link when share is true", async () => {
    mockUploadChain("content.txt", 5);
    vi.mocked(forward.forwardToApiRoute)
      .mockResolvedValueOnce({ ok: true, status: 200, body: publishBody })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: {
          id: shareLinkId,
          type: "share",
          artifact_id: artifactId,
          revision_id: null,
          created_at: expiresAt,
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { url: "https://share.example/al_01" } });

    const result = await runTextPublishChain({ title: "Note", body: "hello", render_mode: "text", share: true }, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toMatchObject({
        access_link_url: "https://share.example/al_01",
      });
      expect(result.body).not.toHaveProperty("revision_link_url");
      expect(result.body).not.toHaveProperty("share_link_url");
    }
    const shareCreateCall = vi.mocked(forward.forwardToApiRoute).mock.calls[1]?.[0];
    expect(shareCreateCall).toMatchObject({
      routeId: "accessLinks.create",
      idempotencyKey: mcpPublishAccessLinkIdempotencyKey(deps.idempotencyKey),
    });
    expect(shareCreateCall?.idempotencyKey).not.toBe(deps.idempotencyKey);
    expect(JSON.parse(shareCreateCall?.body as string)).toEqual({ type: "share" });
    const shareMintCall = vi.mocked(forward.forwardToApiRoute).mock.calls[2]?.[0];
    expect(shareMintCall).toMatchObject({
      routeId: "accessLinks.mint",
      params: { access_link_id: shareLinkId },
    });
    expect(shareMintCall).not.toHaveProperty("idempotencyKey");
  });

  it("returns internal_error when share mint response is missing a url", async () => {
    mockUploadChain("content.txt", 5);
    vi.mocked(forward.forwardToApiRoute)
      .mockResolvedValueOnce({ ok: true, status: 200, body: publishBody })
      .mockResolvedValueOnce({ ok: true, status: 201, body: { id: shareLinkId } })
      .mockResolvedValueOnce({ ok: true, status: 200, body: {} });

    const result = await runTextPublishChain({ title: "Note", body: "hello", render_mode: "text", share: true }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("internal_error");
    }
  });

  it("omits ttl_seconds from the create forward so the repository applies the per-workspace cap", async () => {
    mockUploadChain("content.txt", 5);
    mockPublish();

    await runTextPublishChain({ title: "Note", body: "hello", render_mode: "text", share: false }, deps);

    const createCall = vi.mocked(forward.forwardToUploadRoute).mock.calls[0]?.[0];
    expect(createCall?.routeId).toBe("uploadSessions.create");
    expect(JSON.parse(createCall?.body as string)).not.toHaveProperty("ttl_seconds");
  });

  it("uses html content type for html render mode", async () => {
    mockUploadChain("index.html", 12);
    mockPublish();

    await runTextPublishChain({ title: "Note", body: "<p>hi</p>", render_mode: "html", share: false }, deps);
    expect(forward.putSignedUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "text/html; charset=utf-8" }),
    );
  });

  it("completes publish and add_revision when the tool idempotency key is max length", async () => {
    const maxToolKey = IdempotencyKey.parse("a".repeat(200));
    const maxDeps = { ...deps, idempotencyKey: maxToolKey };
    const shareKey = mcpPublishAccessLinkIdempotencyKey(maxToolKey);
    expect(IdempotencyKey.safeParse(shareKey).success).toBe(true);

    mockUploadChain("content.txt", 5);
    vi.mocked(forward.forwardToApiRoute)
      .mockResolvedValueOnce({ ok: true, status: 200, body: publishBody })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: {
          id: shareLinkId,
          type: "share",
          artifact_id: artifactId,
          revision_id: null,
          created_at: expiresAt,
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { url: "https://share.example/al_01" } });

    const publishResult = await runTextPublishChain(
      { title: "Note", body: "hello", render_mode: "text", share: true },
      maxDeps,
    );
    expect(publishResult.ok).toBe(true);

    vi.resetAllMocks();
    mockUploadChain("content.txt", 7);
    vi.mocked(forward.forwardToApiRoute)
      .mockResolvedValueOnce({ ok: true, status: 200, body: { ...publishBody, title: "Revision" } })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { artifact_id: artifactId, items: [] } })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: {
          id: shareLinkId,
          type: "share",
          artifact_id: artifactId,
          revision_id: null,
          created_at: expiresAt,
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { url: "https://share.example/al_02" } });

    const addRevisionResult = await runTextPublishChain(
      {
        artifact_id: artifactId,
        body: "updated",
        render_mode: "text",
        share: true,
      },
      maxDeps,
    );
    expect(addRevisionResult.ok).toBe(true);

    const addRevisionShareCreate = vi.mocked(forward.forwardToApiRoute).mock.calls[2]?.[0];
    expect(addRevisionShareCreate?.idempotencyKey).toBe(shareKey);
  });

  it("returns upload failures without calling publish", async () => {
    vi.mocked(forward.forwardToUploadRoute).mockResolvedValue({
      ok: false,
      error: { code: "rate_limited_actor", message: "rate_limited_actor", jsonRpcCode: -32000, httpStatus: 429 },
    });
    const result = await runTextPublishChain({ title: "Note", body: "hello", render_mode: "text", share: false }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited_actor");
    }
  });
});
