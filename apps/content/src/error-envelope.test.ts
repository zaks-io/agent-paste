import { encryptArtifactBytes } from "@agent-paste/storage";
import { describe, expect, it } from "vitest";
import { type Env, handleRequest, signContentToken } from "./index.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactBytesEncryptionEnv = {
  ARTIFACT_BYTES_ENCRYPTION_KEY: "test-artifact-bytes-encryption-key",
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

type EnvelopeBody = {
  error: { code: string; message: string; request_id: string; docs?: string };
};

function denylistAll(): Env["DENYLIST"] {
  return {
    async get() {
      return null;
    },
  };
}

function emptyArtifacts(): Env["ARTIFACTS"] {
  return {
    async get() {
      return null;
    },
  };
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

describe("content error envelope", () => {
  it("404 envelope on unknown route carries request_id", async () => {
    const env: Env = { CONTENT_SIGNING_SECRET: "secret", DENYLIST: denylistAll(), ARTIFACTS: emptyArtifacts() };
    const response = await handleRequest(new Request("https://content.test/missing"), env);
    expect(response.status).toBe(404);
    await expectEnvelope(response, "not_found");
  });

  it("404 on invalid token returns envelope without docs", async () => {
    const env: Env = { CONTENT_SIGNING_SECRET: "secret", DENYLIST: denylistAll(), ARTIFACTS: emptyArtifacts() };
    const response = await handleRequest(new Request("https://content.test/v/bogus.token/index.html"), env);
    expect(response.status).toBe(404);
    const body = await expectEnvelope(response, "not_found");
    expect(body.error.docs).toBeUndefined();
  });

  it("404 on denylisted artifact still includes request_id", async () => {
    const token = await signContentToken(
      { artifact_id: "art_1", revision_id: "rev_1", exp: Math.floor(Date.now() / 1000) + 60 },
      "secret",
    );
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get(key) {
          return key === "ad:art_1" ? "1" : null;
        },
      },
      ARTIFACTS: emptyArtifacts(),
    };
    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);
    expect(response.status).toBe(404);
    await expectEnvelope(response, "not_found");
  });

  it("404 on missing R2 object includes request_id and security headers", async () => {
    const token = await signContentToken(
      { artifact_id: "art_1", revision_id: "rev_1", exp: Math.floor(Date.now() / 1000) + 60 },
      "secret",
    );
    const env: Env = { CONTENT_SIGNING_SECRET: "secret", DENYLIST: denylistAll(), ARTIFACTS: emptyArtifacts() };
    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);
    expect(response.status).toBe(404);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    await expectEnvelope(response, "not_found");
  });

  it("500 envelope echoes a valid inbound X-Request-Id", async () => {
    const token = await signContentToken(
      { artifact_id: "art_1", revision_id: "rev_1", exp: Math.floor(Date.now() / 1000) + 60 },
      "secret",
    );
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: denylistAll(),
      ARTIFACTS: {
        async get() {
          throw new Error("boom");
        },
      },
    };
    const requestId = "trace-abcdef0123456789";
    const response = await handleRequest(
      new Request(`https://content.test/v/${token}/index.html`, { headers: { "x-request-id": requestId } }),
      env,
    );
    expect(response.status).toBe(500);
    const body = await expectEnvelope(response, "internal_error");
    expect(body.error.request_id).toBe(requestId);
    expect(response.headers.get("x-request-id")).toBe(requestId);
  });

  it("ignores malformed inbound X-Request-Id and mints a fresh one", async () => {
    const env: Env = { CONTENT_SIGNING_SECRET: "secret", DENYLIST: denylistAll(), ARTIFACTS: emptyArtifacts() };
    const response = await handleRequest(
      new Request("https://content.test/missing", { headers: { "x-request-id": "bad id" } }),
      env,
    );
    expect(response.status).toBe(404);
    const body = await expectEnvelope(response, "not_found");
    expect(body.error.request_id).not.toBe("bad id");
  });

  it("200 success response on a signed URL echoes inbound X-Request-Id", async () => {
    const token = await signContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["index.html"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const encrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("<h1>ok</h1>"),
      rootSecret: artifactBytesEncryptionEnv.ARTIFACT_BYTES_ENCRYPTION_KEY,
      kid: 1,
      context: {
        workspaceId,
        artifactId: "art_1",
        revisionId: "rev_1",
        normalizedPath: "index.html",
      },
    });
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      ...artifactBytesEncryptionEnv,
      DENYLIST: denylistAll(),
      ARTIFACTS: {
        async get(key) {
          expect(key).toBe("artifacts/art_1/revisions/rev_1/files/index.html");
          return {
            body: new Blob([encrypted.ciphertext]).stream(),
            httpMetadata: { contentType: "text/html" },
            size: encrypted.ciphertext.byteLength,
            customMetadata: encrypted.customMetadata,
          };
        },
      },
    };
    const requestId = "happy-path-req-id";
    const response = await handleRequest(
      new Request(`https://content.test/v/${token}/index.html`, {
        headers: { "x-request-id": requestId },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(requestId);
  });
});
