import { describe, expect, it, vi } from "vitest";
import { type Env, handleRequest, type UploadSessionRecord } from "./index.js";

describe("upload worker", () => {
  it("serves a generated OpenAPI document", async () => {
    const response = await handleRequest(new Request("https://upload.test/openapi.json"), {});
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.toLowerCase()).toContain("application/json");
    const doc = (await response.json()) as {
      info: { title: string };
      paths: Record<
        string,
        Record<string, { responses: Record<string, { description?: string; headers?: Record<string, unknown> }> }>
      >;
    };

    expect(doc.info.title).toBe("Agent Paste Upload API");
    expect(doc.paths["/v1/upload-sessions"]?.post.responses["429"]).toMatchObject({
      description: expect.stringContaining("Actor or workspace rate limit"),
      headers: expect.any(Object),
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
        async peekIdempotentReplay() {
          return null;
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
        async peekIdempotentReplay() {
          return null;
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

  it("replays cached idempotent result without consuming rate budget", async () => {
    const session: UploadSessionRecord = {
      session_id: "upl_replay",
      artifact_id: "art_replay",
      revision_id: "rev_replay",
      expires_at: "2030-01-01T00:00:00.000Z",
      files: [{ path: "index.html", size_bytes: 12 }],
    };
    const rateLimitCalls = { actor: 0, workspace: 0 };
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: {
        async verifyApiKey() {
          return { type: "api_key", id: "key_1", workspace_id: "w_1" };
        },
      },
      DB: {
        async createUploadSession() {
          throw new Error("replayed requests must not create new sessions");
        },
        async getUploadSession() {
          return null;
        },
        async finalizeUploadSession() {
          return {};
        },
        async peekIdempotentReplay({ idempotencyKey, operation }) {
          if (operation === "upload.session.create" && idempotencyKey === "replay") {
            return { result: session };
          }
          return null;
        },
      },
      ACTOR_RATE_LIMIT: {
        async limit() {
          rateLimitCalls.actor += 1;
          return { success: false };
        },
      },
      WORKSPACE_BURST_CAP: {
        async limit() {
          rateLimitCalls.workspace += 1;
          return { success: false };
        },
      },
    };

    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions", {
        method: "POST",
        headers: { authorization: "Bearer ok", "idempotency-key": "replay", "content-type": "application/json" },
        body: JSON.stringify({ files: [{ path: "index.html", size_bytes: 12 }] }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { upload_session_id: string; files: Array<{ put_url: string }> };
    expect(body.upload_session_id).toBe("upl_replay");
    expect(body.files[0]?.put_url).toContain("upl_replay");
    expect(rateLimitCalls).toEqual({ actor: 0, workspace: 0 });
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
        async peekIdempotentReplay() {
          return null;
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
