import { describe, expect, it, vi } from "vitest";
import { type PublishFile, type PublishInput, type PublishTransport, runPublish } from "./publish.js";

const ARTIFACT_ID = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const REVISION_ID = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

function publishResult(overrides: Record<string, unknown> = {}) {
  return {
    artifact_id: ARTIFACT_ID,
    revision_id: REVISION_ID,
    title: "Report",
    private_url: "https://app.test/v/art_1",
    revision_content_url: "https://usercontent.test/v/token/index.md",
    agent_view_url: "https://api.test/v1/public/agent-view/token",
    expires_at: "2026-01-01T00:00:00.000Z",
    bundle: { status: "disabled" },
    ...overrides,
  } as never;
}

function textFile(overrides: Partial<PublishFile> = {}): PublishFile {
  return {
    path: "index.md",
    sizeBytes: 11,
    sha256: "a".repeat(64) as never,
    contentType: "text/markdown; charset=utf-8",
    read: () => new TextEncoder().encode("hello world"),
    ...overrides,
  };
}

function fakeTransport(overrides: Partial<PublishTransport> = {}) {
  const calls: string[] = [];
  const base: PublishTransport = {
    async createUploadSession(_body, _key) {
      calls.push("createUploadSession");
      return {
        upload_session_id: "upl_1",
        artifact_id: ARTIFACT_ID,
        revision_id: REVISION_ID,
        status: "pending",
        expires_at: "2026-01-01T00:00:00.000Z",
        files: [
          {
            status: "upload_required",
            path: "index.md",
            put_url: "https://r2.test/put",
            required_headers: { "x-amz-meta-k": "v" },
            expires_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      } as never;
    },
    async putFile(_url, _bytes, _headers) {
      calls.push("putFile");
    },
    async finalize(_id, _key) {
      calls.push("finalize");
      return { artifact_id: ARTIFACT_ID, revision_id: REVISION_ID } as never;
    },
    async publishRevision(_a, _r, _key, _body) {
      calls.push("publishRevision");
      return publishResult();
    },
    ...overrides,
  };
  return { transport: base, calls };
}

function input(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    files: [textFile()],
    title: "Report" as never,
    entrypoint: "index.md",
    idempotencyKey: "cli_publish_1" as never,
    ...overrides,
  };
}

describe("runPublish", () => {
  it("runs create -> putFile -> finalize -> publishRevision in order", async () => {
    const { transport, calls } = fakeTransport();
    await runPublish(transport, input());
    expect(calls).toEqual(["createUploadSession", "putFile", "finalize", "publishRevision"]);
  });

  it("skips putFile for reused targets and counts them in stats", async () => {
    const putFile = vi.fn(async () => {});
    const { transport } = fakeTransport({
      async createUploadSession() {
        return {
          upload_session_id: "upl_1",
          artifact_id: ARTIFACT_ID,
          revision_id: REVISION_ID,
          status: "pending",
          expires_at: "2026-01-01T00:00:00.000Z",
          files: [{ status: "reused", path: "index.md" }],
        } as never;
      },
      putFile,
    });
    const outcome = await runPublish(transport, input());
    expect(putFile).not.toHaveBeenCalled();
    expect(outcome.uploadStats).toMatchObject({ reusedFiles: 1, reusedBytes: 11, uploadedFiles: 0, totalFiles: 1 });
  });

  it("publishes the revision with no body (content-only, private)", async () => {
    const publishRevision = vi.fn(async () => publishResult());
    const { transport } = fakeTransport({ publishRevision });

    await runPublish(transport, input());
    expect(publishRevision).toHaveBeenLastCalledWith(ARTIFACT_ID, REVISION_ID, "cli_publish_1");
  });

  it("returns the server private_url as the private viewer link", async () => {
    const { transport } = fakeTransport();
    const outcome = await runPublish(transport, input());
    expect(outcome.privateUrl).toBe("https://app.test/v/art_1");
    expect(outcome).not.toHaveProperty("shared");
  });

  it("merges required_headers with content-type on upload", async () => {
    const putFile = vi.fn(async () => {});
    const { transport } = fakeTransport({ putFile });
    await runPublish(transport, input());
    expect(putFile).toHaveBeenCalledWith("https://r2.test/put", expect.any(Uint8Array), {
      "content-type": "text/markdown; charset=utf-8",
      "x-amz-meta-k": "v",
    });
  });

  it("propagates a transport rejection unchanged (no remap)", async () => {
    const failure = new Error("insufficient_scope");
    const { transport } = fakeTransport({
      async publishRevision() {
        throw failure;
      },
    });
    await expect(runPublish(transport, input())).rejects.toBe(failure);
  });

  it("reports per-file upload progress", async () => {
    const onUploadProgress = vi.fn();
    const { transport } = fakeTransport();
    await runPublish(transport, input({ onUploadProgress }));
    expect(onUploadProgress).toHaveBeenCalledWith({ uploadedFiles: 1, totalToUpload: 1, uploadedBytes: 11 });
  });

  it("sends base_revision_id + deleted_paths for a partial-manifest revise", async () => {
    const createUploadSession = vi.fn(fakeTransport().transport.createUploadSession);
    const { transport } = fakeTransport({ createUploadSession });
    await runPublish(transport, input({ baseRevisionId: REVISION_ID as never, deletedPaths: ["old.md" as never] }));
    const body = createUploadSession.mock.calls[0]?.[0];
    expect(body).toMatchObject({ base_revision_id: REVISION_ID, deleted_paths: ["old.md"] });
  });

  it("encodes a patched file as a diff descriptor and omits its sha256", async () => {
    const createUploadSession = vi.fn(fakeTransport().transport.createUploadSession);
    const { transport } = fakeTransport({ createUploadSession });
    const patched = textFile({
      patch: { baseSha256: "b".repeat(64) as never, resultSha256: "c".repeat(64) as never },
    });
    await runPublish(transport, input({ files: [patched], baseRevisionId: REVISION_ID as never }));
    const entry = (createUploadSession.mock.calls[0]?.[0] as { files: Record<string, unknown>[] }).files[0];
    expect(entry).toEqual({
      path: "index.md",
      size_bytes: 11,
      patch: { base_sha256: "b".repeat(64), format: "unified", result_sha256: "c".repeat(64) },
    });
    expect(entry).not.toHaveProperty("sha256");
  });

  it("omits deleted_paths when empty", async () => {
    const createUploadSession = vi.fn(fakeTransport().transport.createUploadSession);
    const { transport } = fakeTransport({ createUploadSession });
    await runPublish(transport, input({ deletedPaths: [] }));
    expect(createUploadSession.mock.calls[0]?.[0]).not.toHaveProperty("deleted_paths");
  });
});
