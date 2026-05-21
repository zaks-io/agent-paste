import { describe, expect, it } from "vitest";
import { type Env, handleRequest, type UploadSessionRecord } from "./index.js";

describe("upload worker", () => {
  it("creates signed upload targets", async () => {
    const session: UploadSessionRecord = {
      session_id: "upl_1",
      artifact_id: "art_1",
      revision_id: "rev_1",
      expires_at: "2030-01-01T00:00:00.000Z",
      files: [{ path: "index.html", size_bytes: 12 }],
    };
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1" };
        },
      },
      DB: {
        async createUploadSession() {
          return session;
        },
        async getUploadSession() {
          return session;
        },
        async finalizeUploadSession() {
          return {};
        },
      },
    };

    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions", {
        method: "POST",
        headers: { authorization: "Bearer ok", "idempotency-key": "idem", "content-type": "application/json" },
        body: JSON.stringify({ files: [{ path: "index.html", size_bytes: 12 }] }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { files: Array<{ put_url: string }> };
    expect(body.files[0]?.put_url).toContain("/v1/upload-sessions/upl_1/files/index.html?token=");
  });
});
