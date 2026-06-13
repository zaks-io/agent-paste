import { describe, expect, it, vi } from "vitest";
import { type PublishFile, type PublishInput, type PublishTransport, runPublish } from "./publish.js";

const ARTIFACT_ID = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const REVISION_ID = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

function publishResult(overrides: Record<string, unknown> = {}) {
  return {
    artifact_id: ARTIFACT_ID,
    revision_id: REVISION_ID,
    title: "Report",
    artifact_url: "https://app.test/artifacts/art_1",
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
    share: false,
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

  it("sends {share:true} to publishRevision only when input.share is true", async () => {
    const publishRevision = vi.fn(async () => publishResult());
    const { transport } = fakeTransport({ publishRevision });

    await runPublish(transport, input({ share: false }));
    expect(publishRevision).toHaveBeenLastCalledWith(ARTIFACT_ID, REVISION_ID, "cli_publish_1", undefined);

    await runPublish(transport, input({ share: true }));
    expect(publishRevision).toHaveBeenLastCalledWith(ARTIFACT_ID, REVISION_ID, "cli_publish_1", { share: true });
  });

  it("returns access_link_url as the viewerUrl when shared, else artifact_url", async () => {
    const shared = fakeTransport({
      async publishRevision() {
        return publishResult({ access_link_url: "https://app.test/al/PUBLIC#secret" });
      },
    });
    const sharedOutcome = await runPublish(shared.transport, input({ share: true }));
    expect(sharedOutcome.viewerUrl).toBe("https://app.test/al/PUBLIC#secret");
    expect(sharedOutcome.shared).toBe(true);

    const privateRun = fakeTransport();
    const privateOutcome = await runPublish(privateRun.transport, input());
    expect(privateOutcome.viewerUrl).toBe("https://app.test/artifacts/art_1");
    expect(privateOutcome.shared).toBe(false);
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
});
