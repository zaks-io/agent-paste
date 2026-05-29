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
const revisionLinkId = "al_01HZY7Q8X9Y2S3T4V5W6X7Y8ZA";
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
  view_url: "https://view.example",
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

function mockPublishAndRevisionLink() {
  vi.mocked(forward.forwardToApiRoute)
    .mockResolvedValueOnce({ ok: true, status: 200, body: publishBody })
    .mockResolvedValueOnce({
      ok: true,
      status: 201,
      body: {
        id: revisionLinkId,
        type: "revision",
        artifact_id: artifactId,
        revision_id: revisionId,
        created_at: expiresAt,
      },
    })
    .mockResolvedValueOnce({ ok: true, status: 200, body: { url: "https://revision.example/al_01" } });
}

describe("runTextPublishChain", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("runs create, upload put, finalize, publish, and revision link mint for markdown", async () => {
    mockUploadChain("index.md", 7);
    mockPublishAndRevisionLink();

    const result = await runTextPublishChain({ title: "Note", body: "# hello", render_mode: "markdown" }, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toMatchObject({
        artifact_id: artifactId,
        revision_id: revisionId,
        revision_link_id: revisionLinkId,
        revision_link_url: "https://revision.example/al_01",
        agent_view_url: "https://agent-view.example",
      });
    }
    expect(forward.putSignedUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "text/markdown; charset=utf-8",
      }),
    );
    const revisionCreateCall = vi.mocked(forward.forwardToApiRoute).mock.calls[1]?.[0];
    expect(revisionCreateCall).toMatchObject({
      routeId: "accessLinks.create",
      idempotencyKey: mcpPublishAccessLinkIdempotencyKey(deps.idempotencyKey, "revision"),
    });
    expect(revisionCreateCall?.idempotencyKey).not.toBe(deps.idempotencyKey);
    expect(JSON.parse(revisionCreateCall?.body as string)).toEqual({
      type: "revision",
      revision_id: revisionId,
    });
  });

  it("forwards derived share idempotency keys when publish with share is retried", async () => {
    // Mocks return a fresh access-link row on every create; this file only asserts key
    // propagation on the share create forward. Duplicate-row prevention is covered in
    // packages/db/src/member-mcp-operations.test.ts.
    const shareUrl = "https://share.example/al_01";
    const revisionUrl = "https://revision.example/al_01";
    const shareKey = mcpPublishAccessLinkIdempotencyKey(deps.idempotencyKey, "share");
    const revisionKey = mcpPublishAccessLinkIdempotencyKey(deps.idempotencyKey, "revision");
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
        if (input.idempotencyKey === revisionKey) {
          return {
            ok: true,
            status: 201,
            body: {
              id: revisionLinkId,
              type: "revision",
              artifact_id: artifactId,
              revision_id: revisionId,
              created_at: expiresAt,
            },
          };
        }
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
        const linkId = input.params?.access_link_id;
        return {
          ok: true,
          status: 200,
          body: { url: linkId === revisionLinkId ? revisionUrl : shareUrl },
        };
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
        revision_link_url: revisionUrl,
        share_link_url: shareUrl,
      });
      expect(second.body).toMatchObject({
        revision_link_url: revisionUrl,
        share_link_url: shareUrl,
      });
    }
    expect(shareCreateInvocations).toBe(2);
  });

  it("forwards derived share idempotency keys when add_revision with share is retried", async () => {
    const shareUrl = "https://share.example/al_01";
    const revisionUrl = "https://revision.example/al_01";
    const addRevisionDeps = {
      ...deps,
      idempotencyKey: IdempotencyKey.parse("mcp:user:1:add_revision"),
    };
    const shareKey = mcpPublishAccessLinkIdempotencyKey(addRevisionDeps.idempotencyKey, "share");
    const revisionKey = mcpPublishAccessLinkIdempotencyKey(addRevisionDeps.idempotencyKey, "revision");
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
            title: "Revision",
            entrypoint: "content.txt",
            file_count: 1,
            size_bytes: 7,
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
        return {
          ok: true,
          status: 200,
          body: { ...publishBody, title: "Revision" },
        };
      }
      if (input.routeId === "accessLinks.create") {
        if (input.idempotencyKey === revisionKey) {
          return {
            ok: true,
            status: 201,
            body: {
              id: revisionLinkId,
              type: "revision",
              artifact_id: artifactId,
              revision_id: revisionId,
              created_at: expiresAt,
            },
          };
        }
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
        const linkId = input.params?.access_link_id;
        return {
          ok: true,
          status: 200,
          body: { url: linkId === revisionLinkId ? revisionUrl : shareUrl },
        };
      }
      return {
        ok: false,
        error: { code: "internal_error", message: "internal_error", jsonRpcCode: -32000, httpStatus: 500 },
      };
    });

    const input = {
      artifact_id: artifactId,
      body: "updated",
      render_mode: "text" as const,
      share: true,
    };
    const first = await runTextPublishChain(input, addRevisionDeps);
    const second = await runTextPublishChain(input, addRevisionDeps);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.body).toMatchObject({ share_link_url: shareUrl });
      expect(second.body).toMatchObject({ share_link_url: shareUrl });
    }
    expect(shareCreateInvocations).toBe(2);
  });

  it("mints a share link when share is true", async () => {
    mockUploadChain("content.txt", 5);
    vi.mocked(forward.forwardToApiRoute)
      .mockResolvedValueOnce({ ok: true, status: 200, body: publishBody })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: {
          id: revisionLinkId,
          type: "revision",
          artifact_id: artifactId,
          revision_id: revisionId,
          created_at: expiresAt,
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { url: "https://revision.example/al_01" } })
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
        revision_link_url: "https://revision.example/al_01",
        share_link_url: "https://share.example/al_01",
      });
    }
    const shareCreateCall = vi.mocked(forward.forwardToApiRoute).mock.calls[3]?.[0];
    expect(shareCreateCall).toMatchObject({
      routeId: "accessLinks.create",
      idempotencyKey: mcpPublishAccessLinkIdempotencyKey(deps.idempotencyKey, "share"),
    });
    expect(shareCreateCall?.idempotencyKey).not.toBe(deps.idempotencyKey);
    expect(JSON.parse(shareCreateCall?.body as string)).toEqual({ type: "share" });
    const shareMintCall = vi.mocked(forward.forwardToApiRoute).mock.calls[4]?.[0];
    expect(shareMintCall).toMatchObject({
      routeId: "accessLinks.mint",
      params: { access_link_id: shareLinkId },
    });
    expect(shareMintCall).not.toHaveProperty("idempotencyKey");
  });

  it("returns internal_error when revision link mint response is missing a url", async () => {
    mockUploadChain("content.txt", 5);
    vi.mocked(forward.forwardToApiRoute)
      .mockResolvedValueOnce({ ok: true, status: 200, body: publishBody })
      .mockResolvedValueOnce({ ok: true, status: 201, body: { id: revisionLinkId } })
      .mockResolvedValueOnce({ ok: true, status: 200, body: {} });

    const result = await runTextPublishChain({ title: "Note", body: "hello", render_mode: "text" }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("internal_error");
    }
  });

  it("returns internal_error when share mint response is missing a url", async () => {
    mockUploadChain("content.txt", 5);
    vi.mocked(forward.forwardToApiRoute)
      .mockResolvedValueOnce({ ok: true, status: 200, body: publishBody })
      .mockResolvedValueOnce({ ok: true, status: 201, body: { id: revisionLinkId } })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { url: "https://revision.example/al_01" } })
      .mockResolvedValueOnce({ ok: true, status: 201, body: { id: shareLinkId } })
      .mockResolvedValueOnce({ ok: true, status: 200, body: {} });

    const result = await runTextPublishChain({ title: "Note", body: "hello", render_mode: "text", share: true }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("internal_error");
    }
  });

  it("uses html content type for html render mode", async () => {
    mockUploadChain("index.html", 12);
    mockPublishAndRevisionLink();

    await runTextPublishChain({ title: "Note", body: "<p>hi</p>", render_mode: "html" }, deps);
    expect(forward.putSignedUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "text/html; charset=utf-8" }),
    );
  });

  it("returns upload failures without calling publish", async () => {
    vi.mocked(forward.forwardToUploadRoute).mockResolvedValue({
      ok: false,
      error: { code: "rate_limited_actor", message: "rate_limited_actor", jsonRpcCode: -32000, httpStatus: 429 },
    });
    const result = await runTextPublishChain({ title: "Note", body: "hello", render_mode: "text" }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited_actor");
    }
  });
});
