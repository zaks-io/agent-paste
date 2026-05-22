import { describe, expect, it, vi } from "vitest";
import { type Env, handleRequest, type UploadSessionRecord } from "./index.js";

describe("upload worker", () => {
  it("documents rate-limit responses in OpenAPI", async () => {
    const response = await handleRequest(new Request("https://upload.test/openapi.json"), {});
    const doc = (await response.json()) as {
      paths: Record<
        string,
        Record<string, { responses: Record<string, { description?: string; headers?: Record<string, unknown> }> }>
      >;
    };

    expect(doc.paths["/v1/upload-sessions"]?.post.responses["429"]).toMatchObject({
      description: expect.stringContaining("rate_limited_actor"),
      headers: { "Retry-After": expect.any(Object) },
    });
  });

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
          return { type: "api_key", id: "key_1", workspace_id: "w_1" };
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

  it("returns 429 when the workspace rate limit fires", async () => {
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1" };
        },
      },
      DB: {
        async createUploadSession() {
          throw new Error("rate limited requests should not create sessions");
        },
        async getUploadSession() {
          return null;
        },
        async finalizeUploadSession() {
          return {};
        },
      },
      ACTOR_RATE_LIMIT: {
        async limit() {
          return { success: true };
        },
      },
      WORKSPACE_BURST_CAP: {
        async limit() {
          return { success: false };
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

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("10");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "rate_limited_workspace" } });
  });

  it("fails open when a rate limit binding errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
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
          return { type: "api_key", id: "key_1", workspace_id: "w_1" };
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
      WORKSPACE_BURST_CAP: {
        async limit() {
          throw new Error("binding unavailable");
        },
      },
    };

    try {
      const response = await handleRequest(
        new Request("https://upload.test/v1/upload-sessions", {
          method: "POST",
          headers: { authorization: "Bearer ok", "idempotency-key": "idem", "content-type": "application/json" },
          body: JSON.stringify({ files: [{ path: "index.html", size_bytes: 12 }] }),
        }),
        env,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ upload_session_id: "upl_1" });
      expect(warn).toHaveBeenCalledWith("Rate limit workspace binding failed; allowing request.", expect.any(Error));
    } finally {
      warn.mockRestore();
    }
  });
});
