import { describe, expect, it } from "vitest";
import {
  buildCreateUploadSessionWireResponse,
  observeUploadSessionForFinalize,
  resolveSessionObjectKey,
} from "./upload-session-lifecycle.js";

const session = {
  session_id: "upl_test",
  upload_session_id: "upl_test",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  artifact_id: "art_test",
  revision_id: "rev_test",
  expires_at: "2026-06-01T00:00:00.000Z",
  files: [
    {
      path: "index.html",
      size_bytes: 128,
      object_key: "artifacts/art_test/revisions/rev_test/files/index.html",
      expires_at: "2026-06-01T00:00:00.000Z",
    },
  ],
};

describe("upload-session-lifecycle worker orchestration", () => {
  it("builds create-session wire response with signed put URLs", async () => {
    const response = await buildCreateUploadSessionWireResponse(session, {
      signPutUrl: async (_uploadSession, file) => `https://upload.example/put/${file.path}`,
    });

    expect(response).toEqual({
      upload_session_id: "upl_test",
      artifact_id: "art_test",
      revision_id: "rev_test",
      status: "pending",
      expires_at: "2026-06-01T00:00:00.000Z",
      files: [
        {
          path: "index.html",
          put_url: "https://upload.example/put/index.html",
          required_headers: { "content-length": "128" },
          expires_at: "2026-06-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("reuses an existing put_url when the repository already minted one", async () => {
    const response = await buildCreateUploadSessionWireResponse(
      {
        ...session,
        files: [{ ...session.files[0], put_url: "https://upload.example/existing" }],
      },
      {
        signPutUrl: async () => {
          throw new Error("signPutUrl should not run when put_url is preset");
        },
      },
    );

    expect(response.files[0]?.put_url).toBe("https://upload.example/existing");
  });

  it("observes uploaded bytes before finalize", async () => {
    const observation = await observeUploadSessionForFinalize(session, {
      head: async (key) => (key.endsWith("index.html") ? { size: 128 + 28 } : null),
    });

    expect(observation).toEqual({
      observedFiles: [
        {
          path: "index.html",
          objectKey: "artifacts/art_test/revisions/rev_test/files/index.html",
          sizeBytes: 128,
        },
      ],
    });
  });

  it("reports incomplete uploads by path", async () => {
    const observation = await observeUploadSessionForFinalize(session, {
      head: async () => null,
    });

    expect(observation).toEqual({ incompletePath: "index.html" });
  });

  it("resolves object keys from session ids when none are stored", () => {
    expect(resolveSessionObjectKey(session, "index.html")).toBe(
      "artifacts/art_test/revisions/rev_test/files/index.html",
    );
  });
});
