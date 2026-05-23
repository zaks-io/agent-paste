import { describe, expect, it } from "vitest";
import { type Env, handleRequest, signContentToken } from "./index.js";

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

  it("keeps missing R2 objects as 404 even when the artifact bucket is limited", async () => {
    const token = await signContentToken(
      { artifact_id: "art_1", revision_id: "rev_1", exp: Math.floor(Date.now() / 1000) + 60 },
      "secret",
    );
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: denylistAll(),
      ARTIFACT_RATE_LIMIT: {
        async limit() {
          return { success: false };
        },
      },
      ARTIFACTS: emptyArtifacts(),
    };

    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);

    expect(response.status).toBe(404);
    expect(response.headers.get("Retry-After")).toBeNull();
    await expectEnvelope(response, "not_found");
  });

  it("429 rate_limited_artifact includes Retry-After when the object exists", async () => {
    const token = await signContentToken(
      { artifact_id: "art_1", revision_id: "rev_1", exp: Math.floor(Date.now() / 1000) + 60 },
      "secret",
    );
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: denylistAll(),
      ARTIFACT_RATE_LIMIT: {
        async limit() {
          return { success: false };
        },
      },
      ARTIFACTS: {
        async get() {
          return { body: new Response("<h1>ok</h1>").body, size: 11 };
        },
      },
    };

    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expectEnvelope(response, "rate_limited_artifact");
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
      { artifact_id: "art_1", revision_id: "rev_1", exp: Math.floor(Date.now() / 1000) + 60 },
      "secret",
    );
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: denylistAll(),
      ARTIFACTS: {
        async get() {
          return {
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("<h1>ok</h1>"));
                controller.close();
              },
            }),
            httpMetadata: { contentType: "text/html" },
            size: 11,
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
