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
          status: "upload_required",
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

  it("checks uploaded objects with bounded concurrency", async () => {
    const files = Array.from({ length: 7 }, (_, index) => ({
      ...session.files[0],
      path: `file-${index}.html`,
      object_key: `artifacts/art_test/revisions/rev_test/files/file-${index}.html`,
    }));
    let active = 0;
    let maxActive = 0;
    let releaseFirstBatch!: () => void;
    const firstBatch = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve;
    });

    const observationPromise = observeUploadSessionForFinalize(
      { ...session, files },
      {
        head: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await firstBatch;
          active -= 1;
          return { size: 128 + 28 };
        },
      },
    );

    expect(active).toBe(6);
    releaseFirstBatch();
    const observation = await observationPromise;

    expect(maxActive).toBe(6);
    expect(observation).toEqual({
      observedFiles: files.map((file) => ({
        path: file.path,
        objectKey: file.object_key,
        sizeBytes: file.size_bytes,
      })),
    });
  });

  it("resolves object keys from session ids when none are stored", () => {
    expect(resolveSessionObjectKey(session, "index.html")).toBe(
      "artifacts/art_test/revisions/rev_test/files/index.html",
    );
  });
});
