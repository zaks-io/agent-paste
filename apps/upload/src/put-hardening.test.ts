import { mintUploadToken } from "@agent-paste/tokens/upload-url";
import { describe, expect, it } from "vitest";
import { type Env, handleRequest } from "./index.js";
import { type UploadDbStubOptions, uploadDbStub } from "./upload-db-test-stub.js";

const OBJECT_KEY = "artifacts/art_1/revisions/rev_1/files/index.html";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const SIGNED_SIZE = 5;

function putEnv(options: { db?: Env["DB"] | null; onPut?: () => void }): Env {
  const env: Env = {
    UPLOAD_SIGNING_SECRET: "secret",
    ARTIFACT_BYTES_ENCRYPTION_KEY: "test-artifact-bytes-encryption-key",
    ARTIFACTS: {
      async put() {
        options.onPut?.();
      },
      async head() {
        return null;
      },
    },
  };
  if (options.db === null) {
    return env;
  }
  env.DB = options.db ?? uploadDbStub({ status: "pending" });
  return env;
}

async function putWithBody(input: {
  body: string;
  contentLength: string;
  env: Env;
  signedSize?: number;
}): Promise<Response> {
  const token = await mintUploadToken(
    {
      sid: "upl_1",
      wid: WORKSPACE_ID,
      path: "index.html",
      key: OBJECT_KEY,
      size: input.signedSize ?? SIGNED_SIZE,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    "secret",
  );
  return handleRequest(
    new Request(`https://upload.test/v1/upload-sessions/upl_1/files/index.html?token=${encodeURIComponent(token)}`, {
      method: "PUT",
      headers: { "content-length": input.contentLength, "content-type": "text/html" },
      body: input.body,
    }),
    input.env,
  );
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
}

describe("upload put body-size hardening", () => {
  it("rejects a body larger than the signed size even when content-length lies", async () => {
    let putCalled = false;
    const response = await putWithBody({
      body: "hello world overflow",
      contentLength: String(SIGNED_SIZE),
      env: putEnv({ onPut: () => (putCalled = true) }),
    });
    await expectError(response, 400, "invalid_content_length");
    expect(putCalled).toBe(false);
  });

  it("rejects a body smaller than the signed size even when content-length lies", async () => {
    let putCalled = false;
    const response = await putWithBody({
      body: "hi",
      contentLength: String(SIGNED_SIZE),
      env: putEnv({ onPut: () => (putCalled = true) }),
    });
    await expectError(response, 400, "invalid_content_length");
    expect(putCalled).toBe(false);
  });

  it("rejects when the content-length header does not match the signed size", async () => {
    const response = await putWithBody({
      body: "hello",
      contentLength: "999",
      env: putEnv({}),
    });
    await expectError(response, 400, "invalid_content_length");
  });

  it("stores the object when the body exactly matches the signed size", async () => {
    let putCalled = false;
    const response = await putWithBody({
      body: "hello",
      contentLength: String(SIGNED_SIZE),
      env: putEnv({ onPut: () => (putCalled = true) }),
    });
    expect(response.status).toBe(204);
    expect(putCalled).toBe(true);
  });

  it("propagates an unexpected body read error instead of masking it as a content-length fault", async () => {
    const token = await mintUploadToken(
      {
        sid: "upl_1",
        wid: WORKSPACE_ID,
        path: "index.html",
        key: OBJECT_KEY,
        size: SIGNED_SIZE,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      "secret",
    );
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("stream boom"));
      },
    });
    const response = await handleRequest(
      new Request(`https://upload.test/v1/upload-sessions/upl_1/files/index.html?token=${encodeURIComponent(token)}`, {
        method: "PUT",
        headers: { "content-length": String(SIGNED_SIZE), "content-type": "text/html" },
        body,
        // @ts-expect-error duplex is required by the runtime for a streaming request body.
        duplex: "half",
      }),
      putEnv({}),
    );
    // The framework error handler turns it into a 500, NOT a masked 400 content-length fault.
    await expectError(response, 500, "internal_error");
  });
});

describe("upload put session-state hardening", () => {
  async function putAgainstSession(options: UploadDbStubOptions, onPut?: () => void): Promise<Response> {
    return putWithBody({
      body: "hello",
      contentLength: String(SIGNED_SIZE),
      env: putEnv({ db: uploadDbStub(options), ...(onPut ? { onPut } : {}) }),
    });
  }

  it("rejects a PUT against a finalized session", async () => {
    let putCalled = false;
    const response = await putAgainstSession({ status: "finalized" }, () => (putCalled = true));
    await expectError(response, 409, "upload_session_expired");
    expect(putCalled).toBe(false);
  });

  it("rejects a PUT against an expired session status", async () => {
    const response = await putAgainstSession({ status: "expired" });
    await expectError(response, 409, "upload_session_expired");
  });

  it("rejects a PUT against a pending session past its expiry", async () => {
    const response = await putAgainstSession({
      status: "pending",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expectError(response, 409, "upload_session_expired");
  });

  it("rejects a PUT for a session that no longer exists", async () => {
    const response = await putAgainstSession({ missing: true });
    await expectError(response, 404, "upload_session_not_found");
  });

  it("fails closed when no database binding is configured", async () => {
    let putCalled = false;
    const response = await putWithBody({
      body: "hello",
      contentLength: String(SIGNED_SIZE),
      env: putEnv({ db: null, onPut: () => (putCalled = true) }),
    });
    await expectError(response, 503, "storage_unavailable");
    expect(putCalled).toBe(false);
  });
});
