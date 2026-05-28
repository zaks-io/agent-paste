import { IdempotencyKey } from "@agent-paste/contracts";
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

const deps = {
  api: { fetch: vi.fn() },
  upload: { fetch: vi.fn() },
  bearerToken: "oauth-token",
  idempotencyKey: IdempotencyKey.parse("mcp:user:1:publish_artifact"),
};

describe("runTextPublishChain", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("runs create, upload put, finalize, and publish for markdown", async () => {
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
              path: "index.md",
              put_url: "https://signed/put",
              required_headers: { "x-test": "1" },
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
          entrypoint: "index.md",
          file_count: 1,
          size_bytes: 7,
        },
      });
    vi.mocked(forward.putSignedUploadFile).mockResolvedValue({ ok: true, status: 200, body: null });
    vi.mocked(forward.forwardToApiRoute).mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        artifact_id: artifactId,
        revision_id: revisionId,
        title: "Note",
        view_url: "https://view.example",
        agent_view_url: "https://agent-view.example",
        expires_at: expiresAt,
        bundle: { status: "pending", retry_after_seconds: 30 },
      },
    });

    const result = await runTextPublishChain({ title: "Note", body: "# hello", render_mode: "markdown" }, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toMatchObject({
        artifact_id: artifactId,
        revision_id: revisionId,
        agent_view_url: "https://agent-view.example",
      });
    }
    expect(forward.putSignedUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "text/markdown; charset=utf-8",
      }),
    );
  });

  it("mints a share link when share is true", async () => {
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
              path: "content.txt",
              put_url: "https://signed/put",
              required_headers: {},
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
          entrypoint: "content.txt",
          file_count: 1,
          size_bytes: 5,
        },
      });
    vi.mocked(forward.putSignedUploadFile).mockResolvedValue({ ok: true, status: 200, body: null });
    vi.mocked(forward.forwardToApiRoute)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          artifact_id: artifactId,
          revision_id: revisionId,
          title: "Note",
          view_url: "https://view.example",
          agent_view_url: "https://agent-view.example",
          expires_at: expiresAt,
          bundle: { status: "pending", retry_after_seconds: 30 },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: {
          id: "al_test_share_link",
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
      expect(result.body).toMatchObject({ share_link_url: "https://share.example/al_01" });
    }
    const createLinkCall = vi.mocked(forward.forwardToApiRoute).mock.calls[1]?.[0];
    expect(createLinkCall).toMatchObject({
      routeId: "accessLinks.create",
      idempotencyKey: deps.idempotencyKey,
    });
    const mintCall = vi.mocked(forward.forwardToApiRoute).mock.calls[2]?.[0];
    expect(mintCall).toMatchObject({
      routeId: "accessLinks.mint",
      params: { access_link_id: "al_test_share_link" },
    });
    expect(mintCall).not.toHaveProperty("idempotencyKey");
  });

  it("returns internal_error when share mint response is missing a url", async () => {
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
              path: "content.txt",
              put_url: "https://signed/put",
              required_headers: {},
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
          entrypoint: "content.txt",
          file_count: 1,
          size_bytes: 5,
        },
      });
    vi.mocked(forward.putSignedUploadFile).mockResolvedValue({ ok: true, status: 200, body: null });
    vi.mocked(forward.forwardToApiRoute)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          artifact_id: artifactId,
          revision_id: revisionId,
          title: "Note",
          view_url: "https://view.example",
          agent_view_url: "https://agent-view.example",
          expires_at: expiresAt,
          bundle: { status: "pending", retry_after_seconds: 30 },
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 201, body: { id: "al_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" } })
      .mockResolvedValueOnce({ ok: true, status: 200, body: {} });

    const result = await runTextPublishChain({ title: "Note", body: "hello", render_mode: "text", share: true }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("internal_error");
    }
  });

  it("uses html content type for html render mode", async () => {
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
              path: "index.html",
              put_url: "https://signed/put",
              required_headers: {},
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
          entrypoint: "index.html",
          file_count: 1,
          size_bytes: 12,
        },
      });
    vi.mocked(forward.putSignedUploadFile).mockResolvedValue({ ok: true, status: 200, body: null });
    vi.mocked(forward.forwardToApiRoute).mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        artifact_id: artifactId,
        revision_id: revisionId,
        title: "Note",
        view_url: "https://view.example",
        agent_view_url: "https://agent-view.example",
        expires_at: expiresAt,
        bundle: { status: "pending", retry_after_seconds: 30 },
      },
    });

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
