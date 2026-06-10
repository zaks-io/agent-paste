import { ARTIFACT_BYTES_BLOB_AAD_VERSION, workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import { mintUploadToken } from "@agent-paste/tokens/upload-url";
import { describe, expect, it } from "vitest";
import { type Env, handleRequest } from "./index.js";
import { type UploadDbStubOptions, uploadDbStub } from "./upload-db-test-stub.js";

const OBJECT_KEY = "artifacts/art_1/revisions/rev_1/files/index.html";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const SIGNED_SIZE = 5;
const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

function putEnv(options: {
  db?: Env["DB"] | null;
  onPut?: (input: { key: string; metadata?: Record<string, string> }) => void;
}): Env {
  const env: Env = {
    UPLOAD_SIGNING_SECRET: "secret",
    ARTIFACT_BYTES_ENCRYPTION_KEY: "test-artifact-bytes-encryption-key",
    ARTIFACTS: {
      async put(key, _value, putOptions) {
        options.onPut?.({ key, metadata: putOptions?.customMetadata });
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
  path?: string;
}): Promise<Response> {
  const path = input.path ?? "index.html";
  const token = await mintUploadToken(
    {
      sid: "upl_1",
      wid: WORKSPACE_ID,
      path,
      key: `artifacts/art_1/revisions/rev_1/files/${path}`,
      size: input.signedSize ?? SIGNED_SIZE,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    "secret",
  );
  return handleRequest(
    new Request(`https://upload.test/v1/upload-sessions/upl_1/files/${path}?token=${encodeURIComponent(token)}`, {
      method: "PUT",
      headers: { "content-length": input.contentLength, "content-type": "text/html" },
      body: input.body,
    }),
    input.env,
  );
}

async function putBlobWithBody(input: {
  body: string;
  contentLength: string;
  env: Env;
  sha256?: string;
}): Promise<Response> {
  const sha256 = input.sha256 ?? HELLO_SHA256;
  const token = await mintUploadToken(
    {
      sid: "upl_1",
      wid: WORKSPACE_ID,
      path: "index.html",
      key: workspaceBlobObjectKeyFor({ workspaceId: WORKSPACE_ID, sha256 }),
      size: SIGNED_SIZE,
      sha256,
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

  it("stores a file at a nested path", async () => {
    let putCalled = false;
    const response = await putWithBody({
      body: "hello",
      contentLength: String(SIGNED_SIZE),
      env: putEnv({ onPut: () => (putCalled = true) }),
      path: "assets/app.js",
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

describe("upload put sha256 dedupe enforcement", () => {
  it("rejects a blob PUT whose plaintext hash does not match the signed digest", async () => {
    let putCalled = false;
    let recordCalled = false;
    const response = await putBlobWithBody({
      body: "hello",
      contentLength: String(SIGNED_SIZE),
      sha256: "b".repeat(64),
      env: putEnv({
        db: uploadDbStub({ status: "pending", onRecord: () => (recordCalled = true) }),
        onPut: () => (putCalled = true),
      }),
    });

    await expectError(response, 400, "invalid_request");
    expect(putCalled).toBe(false);
    expect(recordCalled).toBe(false);
  });

  it("stores blob uploads with v2 AAD metadata and records the verified digest", async () => {
    let putInput: { key: string; metadata?: Record<string, string> } | undefined;
    let recordInput: Parameters<NonNullable<UploadDbStubOptions["onRecord"]>>[0] | undefined;
    const response = await putBlobWithBody({
      body: "hello",
      contentLength: String(SIGNED_SIZE),
      env: putEnv({
        db: uploadDbStub({ status: "pending", onRecord: (input) => (recordInput = input) }),
        onPut: (input) => (putInput = input),
      }),
    });

    expect(response.status).toBe(204);
    const expectedKey = workspaceBlobObjectKeyFor({ workspaceId: WORKSPACE_ID, sha256: HELLO_SHA256 });
    expect(putInput).toMatchObject({
      key: expectedKey,
      metadata: expect.objectContaining({ enc_aad_v: ARTIFACT_BYTES_BLOB_AAD_VERSION }),
    });
    expect(recordInput).toMatchObject({
      workspaceId: WORKSPACE_ID,
      sessionId: "upl_1",
      path: "index.html",
      objectKey: expectedKey,
      sizeBytes: SIGNED_SIZE,
      sha256: HELLO_SHA256,
    });
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

  it("rejects a replayed PUT when the session finalizes between the guard and the write", async () => {
    // TOCTOU: the session is pending at the initial guard, then finalize completes
    // while the body is being read. The pre-write re-check must reject the write so
    // published bytes are never mutated under an unchanged strong ETag.
    let putCalled = false;
    let recorded = false;
    const response = await putWithBody({
      body: "hello",
      contentLength: String(SIGNED_SIZE),
      env: putEnv({
        db: uploadDbStub({ statusSequence: ["pending", "finalized"], onRecord: () => (recorded = true) }),
        onPut: () => (putCalled = true),
      }),
    });
    await expectError(response, 409, "upload_session_expired");
    expect(putCalled).toBe(false);
    expect(recorded).toBe(false);
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
