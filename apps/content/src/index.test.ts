import { describe, expect, it } from "vitest";
import { type Env, handleRequest, signContentToken } from "./index.js";

describe("content worker", () => {
  it("serves signed R2 content without a DB binding", async () => {
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["index.html"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get() {
          return null;
        },
      },
      ARTIFACTS: {
        async get(key) {
          expect(key).toBe("artifacts/art_1/revisions/rev_1/files/index.html");
          return {
            body: new Response("<h1>ok</h1>").body,
            size: 11,
          };
        },
      },
    };

    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    await expect(response.text()).resolves.toBe("<h1>ok</h1>");
  });

  it("ignores client-provided R2 content type metadata", async () => {
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["notes.txt"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get() {
          return null;
        },
      },
      ARTIFACTS: {
        async get() {
          return {
            body: new Response("<script>alert(1)</script>").body,
            size: 25,
            httpMetadata: { contentType: "text/html" },
            writeHttpMetadata(headers) {
              headers.set("content-type", "text/html");
            },
          };
        },
      },
    };

    const response = await handleRequest(new Request(`https://content.test/v/${token}/notes.txt`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("forces unknown extensions to download", async () => {
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["payload.bin"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get() {
          return null;
        },
      },
      ARTIFACTS: {
        async get() {
          return {
            body: new Response("opaque").body,
            size: 6,
            httpMetadata: { contentType: "text/html" },
          };
        },
      },
    };

    const response = await handleRequest(new Request(`https://content.test/v/${token}/payload.bin`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="payload.bin"');
  });

  it("uses the strict SVG CSP override", async () => {
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["chart.svg"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get() {
          return null;
        },
      },
      ARTIFACTS: {
        async get() {
          return {
            body: new Response("<svg></svg>").body,
            size: 11,
          };
        },
      },
    };

    const response = await handleRequest(new Request(`https://content.test/v/${token}/chart.svg`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    );
  });

  it("rejects denylisted artifacts", async () => {
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get(key) {
          return key === "artifact:art_1" ? "1" : null;
        },
      },
      ARTIFACTS: {
        async get() {
          throw new Error("should not read denied content");
        },
      },
    };

    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);
    expect(response.status).toBe(404);
  });
});
