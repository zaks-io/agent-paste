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
