import { routeContracts } from "@agent-paste/contracts";
import { describe, expect, it, vi } from "vitest";
import { type Env, handleRequest, mountedRouteIds, nonContractRoutePaths, signContentToken } from "./index.js";

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
  it("mounts every content route contract", () => {
    expect([...mountedRouteIds].sort()).toEqual(
      routeContracts
        .filter((route) => route.app === "content")
        .map((route) => route.id)
        .sort(),
    );
    expect([...nonContractRoutePaths]).toEqual(["/openapi.json"]);
  });

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
    const rateLimitKeys: string[] = [];
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
      ARTIFACT_RATE_LIMIT: {
        async limit({ key }) {
          rateLimitKeys.push(key);
          return { success: true };
        },
      },
    };

    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);

    expect(response.status).toBe(200);
    expect(rateLimitKeys).toEqual(["art_1"]);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    await expect(response.text()).resolves.toBe("<h1>ok</h1>");
  });

  it("serves signed HEAD metadata under the artifact read limit", async () => {
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["index.html"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const rateLimitKeys: string[] = [];
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get() {
          return null;
        },
      },
      ARTIFACTS: {
        async get() {
          throw new Error("HEAD should use R2 head when available");
        },
        async head(key) {
          expect(key).toBe("artifacts/art_1/revisions/rev_1/files/index.html");
          return {
            body: null,
            size: 11,
          };
        },
      },
      ARTIFACT_RATE_LIMIT: {
        async limit({ key }) {
          rateLimitKeys.push(key);
          return { success: true };
        },
      },
    };

    const response = await handleRequest(
      new Request(`https://content.test/v/${token}/index.html`, { method: "HEAD" }),
      env,
    );

    expect(response.status).toBe(200);
    expect(rateLimitKeys).toEqual(["art_1"]);
    expect(response.headers.get("content-length")).toBe("11");
    await expect(response.text()).resolves.toBe("");
  });

  it("returns rate_limited_artifact before reading R2 when the artifact limit is exceeded", async () => {
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
        async get() {
          throw new Error("should not read over-limit content");
        },
      },
      ARTIFACT_RATE_LIMIT: {
        async limit({ key }) {
          expect(key).toBe("art_1");
          return { success: false };
        },
      },
    };

    const response = await handleRequest(
      new Request(`https://content.test/v/${token}/index.html`, { headers: { "x-request-id": "limit-req-12345" } }),
      env,
    );
    const body = (await response.json()) as { error: { code: string; request_id: string } };

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("x-request-id")).toBe("limit-req-12345");
    expect(body.error.code).toBe("rate_limited_artifact");
    expect(body.error.request_id).toBe("limit-req-12345");
  });

  it("does not call the artifact limiter for invalid tokens or paths", async () => {
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["index.html"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    let limitCalls = 0;
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get() {
          return null;
        },
      },
      ARTIFACTS: {
        async get() {
          throw new Error("should not read invalid content");
        },
      },
      ARTIFACT_RATE_LIMIT: {
        async limit() {
          limitCalls += 1;
          return { success: true };
        },
      },
    };

    const invalidTokenResponse = await handleRequest(new Request("https://content.test/v/bogus.token/index.html"), env);
    const invalidPathResponse = await handleRequest(new Request(`https://content.test/v/${token}/admin.html`), env);

    expect(invalidTokenResponse.status).toBe(404);
    expect(invalidPathResponse.status).toBe(404);
    expect(limitCalls).toBe(0);
  });

  it("does not call the artifact limiter for denylisted artifacts or revisions", async () => {
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["index.html"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    let limitCalls = 0;
    const envForDenyKey = (denyKey: string): Env => ({
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get(key) {
          return key === denyKey ? "1" : null;
        },
      },
      ARTIFACTS: {
        async get() {
          throw new Error("should not read denied content");
        },
      },
      ARTIFACT_RATE_LIMIT: {
        async limit() {
          limitCalls += 1;
          return { success: true };
        },
      },
    });

    const artifactResponse = await handleRequest(
      new Request(`https://content.test/v/${token}/index.html`),
      envForDenyKey("ad:art_1"),
    );
    const revisionResponse = await handleRequest(
      new Request(`https://content.test/v/${token}/index.html`),
      envForDenyKey("rd:rev_1"),
    );

    expect(artifactResponse.status).toBe(404);
    expect(revisionResponse.status).toBe(404);
    expect(limitCalls).toBe(0);
  });

  it("allows the read and logs a warning when the artifact rate-limit binding fails", async () => {
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["index.html"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
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
            body: new Response("<h1>ok</h1>").body,
            size: 11,
          };
        },
      },
      ARTIFACT_RATE_LIMIT: {
        async limit() {
          throw new Error("rate limit unavailable");
        },
      },
    };

    try {
      const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("<h1>ok</h1>");
      expect(warn).toHaveBeenCalledWith("Rate limit artifact binding failed; allowing request.", expect.any(Error));
    } finally {
      warn.mockRestore();
    }
  });

  it("checks ADR 0057 artifact and revision denylist keys without a token-hash key", async () => {
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["index.html"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const checkedKeys: string[] = [];
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get(key) {
          checkedKeys.push(key);
          return null;
        },
      },
      ARTIFACTS: {
        async get() {
          return { body: new Response("<h1>ok</h1>").body, size: 11 };
        },
      },
    };

    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);

    expect(response.status).toBe(200);
    expect(checkedKeys).toEqual(["ad:art_1", "rd:rev_1"]);
  });

  it("checks workspace and access-link denylist keys only when the token carries those ids", async () => {
    const token = await signContentToken(
      {
        workspace_id: "00000000-0000-4000-8000-000000000001",
        artifact_id: "art_1",
        revision_id: "rev_1",
        access_link_id: "al_1",
        paths: ["index.html"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const checkedKeys: string[] = [];
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get(key) {
          checkedKeys.push(key);
          return key === "ald:al_1" ? "1" : null;
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
    expect(checkedKeys).toEqual(["wsd:00000000-0000-4000-8000-000000000001", "ad:art_1", "rd:rev_1", "ald:al_1"]);
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
          return key === "ad:art_1" ? "1" : null;
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
