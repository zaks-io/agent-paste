import { IdempotencyInFlightError } from "@agent-paste/commands";
import { describe, expect, it } from "vitest";
import { type Env, handleRequest, type UploadSessionRecord } from "./index.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

type EnvelopeBody = {
  error: { code: string; message: string; request_id: string; docs?: string };
};

function workspaceSession(): UploadSessionRecord {
  return {
    session_id: "upl_1",
    artifact_id: "art_1",
    revision_id: "rev_1",
    expires_at: "2030-01-01T00:00:00.000Z",
    files: [{ path: "index.html", size_bytes: 12 }],
  };
}

function workspaceAuth(): NonNullable<Env["AUTH"]> {
  return {
    async verifyApiKey() {
      return { type: "api_key", id: "key_1", workspace_id: "w_1", scopes: ["publish"] };
    },
  };
}

function createUploadRequestBody(
  files: Array<{ path: string; size_bytes: number }> = [{ path: "index.html", size_bytes: 12 }],
) {
  return { title: "Demo", entrypoint: "index.html", files };
}

async function expectEnvelope(response: Response, code: string): Promise<EnvelopeBody> {
  const headerId = response.headers.get("x-request-id");
  expect(headerId).toMatch(REQUEST_ID_PATTERN);
  const body = (await response.json()) as EnvelopeBody;
  expect(body.error.code).toBe(code);
  expect(body.error.message.length).toBeGreaterThan(0);
  expect(body.error.request_id).toBe(headerId);
  return body;
}

describe("upload error envelope", () => {
  it("404 envelope carries request_id and matching header", async () => {
    const response = await handleRequest(new Request("https://upload.test/missing"), {});
    expect(response.status).toBe(404);
    await expectEnvelope(response, "not_found");
  });

  it("401 envelope is returned when bearer is missing", async () => {
    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      {},
    );
    expect(response.status).toBe(401);
    const body = await expectEnvelope(response, "not_authenticated");
    expect(body.error.docs).toBeUndefined();
  });

  it("409 idempotency_in_flight includes docs URL when DOCS_BASE_URL is set", async () => {
    const env: Env = {
      DOCS_BASE_URL: "https://docs.agent-paste.sh",
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: workspaceAuth(),
      DB: {
        async createUploadSession() {
          throw new IdempotencyInFlightError("upload.session.create", "k");
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
    };

    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions", {
        method: "POST",
        headers: {
          authorization: "Bearer ok",
          "idempotency-key": "k",
          "content-type": "application/json",
        },
        body: JSON.stringify(createUploadRequestBody()),
      }),
      env,
    );

    expect(response.status).toBe(409);
    const body = await expectEnvelope(response, "idempotency_in_flight");
    expect(body.error.docs).toBe("https://docs.agent-paste.sh/errors/idempotency_in_flight");
  });

  it("400 invalid_request emits envelope for empty files", async () => {
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: workspaceAuth(),
      DB: {
        async createUploadSession() {
          return workspaceSession();
        },
        async getUploadSession() {
          return workspaceSession();
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
        headers: {
          authorization: "Bearer ok",
          "idempotency-key": "k",
          "content-type": "application/json",
        },
        body: JSON.stringify(createUploadRequestBody([])),
      }),
      env,
    );
    expect(response.status).toBe(400);
    await expectEnvelope(response, "invalid_request");
  });

  it("429 rate_limited_workspace includes Retry-After and docs URL", async () => {
    const env: Env = {
      DOCS_BASE_URL: "https://docs.agent-paste.sh/",
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: workspaceAuth(),
      DB: {
        async createUploadSession() {
          throw new Error("should not run when rate limited");
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
        headers: {
          authorization: "Bearer ok",
          "idempotency-key": "k",
          "content-type": "application/json",
        },
        body: JSON.stringify(createUploadRequestBody()),
      }),
      env,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("10");
    const body = await expectEnvelope(response, "rate_limited_workspace");
    expect(body.error.docs).toBe("https://docs.agent-paste.sh/errors/rate_limited_workspace");
  });

  it("500 envelope echoes a valid inbound X-Request-Id", async () => {
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: workspaceAuth(),
      DB: {
        async createUploadSession() {
          throw new Error("boom");
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
    };
    const requestId = "trace-abcdef0123456789";
    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions", {
        method: "POST",
        headers: {
          authorization: "Bearer ok",
          "idempotency-key": "k",
          "content-type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify(createUploadRequestBody()),
      }),
      env,
    );

    expect(response.status).toBe(500);
    const body = await expectEnvelope(response, "internal_error");
    expect(body.error.request_id).toBe(requestId);
    expect(response.headers.get("x-request-id")).toBe(requestId);
  });

  it("ignores malformed inbound X-Request-Id", async () => {
    const response = await handleRequest(
      new Request("https://upload.test/missing", { headers: { "x-request-id": "bad id" } }),
      {},
    );
    expect(response.status).toBe(404);
    const body = await expectEnvelope(response, "not_found");
    expect(body.error.request_id).not.toBe("bad id");
  });

  it("400 invalid_request when upload session ttl exceeds the workspace plan max", async () => {
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: workspaceAuth(),
      DB: {
        async createUploadSession() {
          throw new Error("invalid_ttl_seconds");
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
    };

    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions", {
        method: "POST",
        headers: {
          authorization: "Bearer ok",
          "idempotency-key": "k",
          "content-type": "application/json",
        },
        body: JSON.stringify(createUploadRequestBody()),
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expectEnvelope(response, "invalid_request");
  });

  it("200 idempotent replay on upload-session create echoes X-Request-Id", async () => {
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      AUTH: workspaceAuth(),
      DB: {
        async createUploadSession() {
          return { ...workspaceSession(), put_urls: [] };
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
    };

    const requestId = "upload-happy-path-id";
    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions", {
        method: "POST",
        headers: {
          authorization: "Bearer ok",
          "idempotency-key": "k",
          "content-type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify(createUploadRequestBody()),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(requestId);
  });
});
