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
    // The PUT-URL token expiry is much shorter than the session TTL; the wire
    // response must advertise the token expiry on each file, not the session's.
    const putUrlExpiresAt = "2026-05-31T00:15:00.000Z";
    const response = await buildCreateUploadSessionWireResponse(session, {
      signPutUrl: async (_uploadSession, file) => ({
        url: `https://upload.example/put/${file.path}`,
        expiresAt: putUrlExpiresAt,
      }),
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
          expires_at: putUrlExpiresAt,
        },
      ],
    });
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
