import { describe, expect, it } from "vitest";
import { type Env, handleRequest, signContentToken } from "./index.js";

async function fetchServedFile(path: string, body = "ok"): Promise<Response> {
  const token = await signContentToken(
    {
      artifact_id: "art_1",
      revision_id: "rev_1",
      paths: [path],
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
        expect(key).toBe(`artifacts/art_1/revisions/rev_1/files/${path}`);
        return { body: new Response(body).body, size: body.length };
      },
    },
  };
  return await handleRequest(new Request(`https://content.test/v/${token}/${path}`), env);
}

describe("content worker", () => {
  it("serves a generated OpenAPI document", async () => {
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get() {
          return null;
        },
      },
      ARTIFACTS: {
        async get() {
          return null;
        },
      },
    };
    const response = await handleRequest(new Request("https://content.test/openapi.json"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.toLowerCase()).toContain("application/json");
    const doc = (await response.json()) as { info: { title: string } };
    expect(doc.info.title).toBe("Agent Paste Content API");
  });

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

describe("CSP header per content type", () => {
  it("pins the HTML CSP", async () => {
    const response = await fetchServedFile("index.html");
    expect(response.headers.get("content-security-policy")).toMatchInlineSnapshot(
      `"default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"`,
    );
  });

  it("pins the CSS CSP", async () => {
    const response = await fetchServedFile("styles.css");
    expect(response.headers.get("content-security-policy")).toMatchInlineSnapshot(
      `"default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"`,
    );
  });

  it("pins the JS CSP", async () => {
    const response = await fetchServedFile("app.js");
    expect(response.headers.get("content-security-policy")).toMatchInlineSnapshot(
      `"default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"`,
    );
  });

  it("pins the SVG strict CSP override", async () => {
    const response = await fetchServedFile("chart.svg");
    expect(response.headers.get("content-security-policy")).toMatchInlineSnapshot(
      `"default-src 'none'; style-src 'unsafe-inline'; img-src data:"`,
    );
  });

  it("pins the PNG CSP", async () => {
    const response = await fetchServedFile("photo.png");
    expect(response.headers.get("content-security-policy")).toMatchInlineSnapshot(
      `"default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"`,
    );
  });
});
