import { routeContracts } from "@agent-paste/contracts";
import { encryptArtifactBytes } from "@agent-paste/storage";
import {
  seedEncryptedRevisionFile,
  testArtifactBytesEncryptionEnv as sharedTestEncryptionEnv,
} from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import { describe, expect, it, vi } from "vitest";
import { contentEtag } from "./etag.js";
import { type Env, handleRequest, mountedRouteIds, nonContractRoutePaths, signContentToken } from "./index.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactBytesEncryptionEnv = {
  ARTIFACT_BYTES_ENCRYPTION_KEY: "test-artifact-bytes-encryption-key",
};

async function encryptedArtifactObject(input: {
  artifactId: string;
  revisionId: string;
  path: string;
  plaintext: string;
}) {
  const encrypted = await encryptArtifactBytes({
    plaintext: new TextEncoder().encode(input.plaintext),
    rootSecret: artifactBytesEncryptionEnv.ARTIFACT_BYTES_ENCRYPTION_KEY,
    kid: 1,
    context: {
      workspaceId,
      artifactId: input.artifactId,
      revisionId: input.revisionId,
      normalizedPath: input.path,
    },
  });
  return {
    body: new Blob([encrypted.ciphertext]).stream(),
    size: encrypted.ciphertext.byteLength,
    customMetadata: encrypted.customMetadata,
    plaintextLength: input.plaintext.length,
  };
}

function baseContentEnv(overrides: Partial<Env> = {}): Env {
  return {
    CONTENT_SIGNING_SECRET: "secret",
    ...artifactBytesEncryptionEnv,
    DENYLIST: {
      async get() {
        return null;
      },
    },
    ARTIFACT_RATE_LIMIT: {
      async limit() {
        return { success: true };
      },
    },
    ARTIFACTS: {
      async get() {
        return null;
      },
    },
    ...overrides,
  };
}

async function fetchServedFile(
  path: string,
  body = "ok",
  tokenOptions: { script_disabled?: boolean; noindex?: boolean } = { script_disabled: false },
  requestHeaders: HeadersInit = {},
  envOverrides: Partial<Env> = {},
): Promise<Response> {
  const token = await signContentToken(
    {
      workspace_id: workspaceId,
      artifact_id: "art_1",
      revision_id: "rev_1",
      paths: [path],
      exp: Math.floor(Date.now() / 1000) + 60,
      ...tokenOptions,
    },
    "secret",
  );
  const stored = await encryptedArtifactObject({
    artifactId: "art_1",
    revisionId: "rev_1",
    path,
    plaintext: body,
  });
  const env = baseContentEnv({
    ...envOverrides,
    ARTIFACTS: {
      async get(key) {
        expect(key).toBe(`artifacts/art_1/revisions/rev_1/files/${path}`);
        return stored;
      },
    },
  });
  return await handleRequest(new Request(`https://content.test/v/${token}/${path}`, { headers: requestHeaders }), env);
}

const viewerFrameHeaders = {
  "sec-fetch-dest": "iframe",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-site",
};

describe("content worker", () => {
  it("mounts every content route contract", () => {
    expect([...mountedRouteIds].sort()).toEqual(
      routeContracts
        .filter((route) => route.app === "content")
        .map((route) => route.id)
        .sort(),
    );
    expect([...nonContractRoutePaths]).toEqual(["/healthz", "/openapi.json"]);
  });

  it("GET /healthz returns 200 with no cookies", async () => {
    const env = baseContentEnv();
    const response = await handleRequest(new Request("https://content.test/healthz"), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("serves a generated OpenAPI document", async () => {
    const env = baseContentEnv();
    const response = await handleRequest(new Request("https://content.test/openapi.json"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.toLowerCase()).toContain("application/json");
    const doc = (await response.json()) as { info: { title: string } };
    expect(doc.info.title).toBe("Agent Paste Content API");
  });

  it("serves signed R2 content without a DB binding", async () => {
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
    const rateLimitKeys: string[] = [];
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "index.html",
      plaintext: "<h1>ok</h1>",
    });
    const env = baseContentEnv({
      ARTIFACTS: {
        async get(key) {
          expect(key).toBe("artifacts/art_1/revisions/rev_1/files/index.html");
          return stored;
        },
      },
      ARTIFACT_RATE_LIMIT: {
        async limit({ key }) {
          rateLimitKeys.push(key);
          return { success: true };
        },
      },
    });

    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);

    expect(response.status).toBe(200);
    expect(rateLimitKeys).toEqual(["art_1"]);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    // Baseline headers layered under the content-specific set.
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await expect(response.text()).resolves.toBe("<h1>ok</h1>");
  });

  it("lets sandboxed artifact scripts fetch same-token JSON assets from an opaque origin", async () => {
    const token = await signContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["index.html", "data/latest.json"],
        script_disabled: false,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "data/latest.json",
      plaintext: '{"ok":true}',
    });
    const env = baseContentEnv({
      ARTIFACTS: {
        async get(key) {
          expect(key).toBe("artifacts/art_1/revisions/rev_1/files/data/latest.json");
          return stored;
        },
      },
    });

    const response = await handleRequest(
      new Request(`https://content.test/v/${token}/data/latest.json`, { headers: { origin: "null" } }),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("access-control-allow-origin")).toBe("null");
    expect(response.headers.get("vary")).toBe("Origin");
    await expect(response.text()).resolves.toBe('{"ok":true}');
  });

  it("lets the production app origin frame served HTML and drops X-Frame-Options", async () => {
    const token = await signContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["index.html"],
        script_disabled: false,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "index.html",
      plaintext: "<h1>ok</h1>",
    });
    const env = baseContentEnv({
      AGENT_PASTE_ENV: "production",
      ARTIFACTS: {
        async get() {
          return stored;
        },
      },
    });

    const response = await handleRequest(
      new Request(`https://content.test/v/${token}/index.html`, { headers: viewerFrameHeaders }),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors https://app.agent-paste.sh");
    expect(response.headers.get("content-security-policy")).not.toContain("frame-ancestors 'none'");
    // The middleware must not re-stamp the origin-blind XFO over the CSP allowance.
    expect(response.headers.get("x-frame-options")).toBeNull();
  });

  it("adds noindex headers and meta for ephemeral content tokens", async () => {
    const token = await signContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["index.html"],
        noindex: true,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "index.html",
      plaintext: "<html><head><title>x</title></head><body>ok</body></html>",
    });
    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), {
      ...baseContentEnv({
        ARTIFACTS: {
          async get() {
            return stored;
          },
        },
      }),
    });
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    await expect(response.text()).resolves.toContain('<meta name="robots" content="noindex,nofollow">');
  });

  it("does not duplicate robots meta when it is already present", async () => {
    const token = await signContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["index.html"],
        noindex: true,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const html = '<html><head><meta name="robots" content="noindex,nofollow"></head><body>ok</body></html>';
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "index.html",
      plaintext: html,
    });
    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), {
      ...baseContentEnv({
        ARTIFACTS: {
          async get() {
            return stored;
          },
        },
      }),
    });
    await expect(response.text()).resolves.toBe(html);
  });

  it("prepends robots meta when HTML lacks a head element", async () => {
    const token = await signContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["page.html"],
        noindex: true,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "page.html",
      plaintext: "<p>plain</p>",
    });
    const response = await handleRequest(new Request(`https://content.test/v/${token}/page.html`), {
      ...baseContentEnv({
        ARTIFACTS: {
          async get() {
            return stored;
          },
        },
      }),
    });
    await expect(response.text()).resolves.toBe('<meta name="robots" content="noindex,nofollow"><p>plain</p>');
  });

  it.each([
    ["<html><head><title>x</title></head><body>ok</body></html>", "head present"],
    ["<p>plain</p>", "no head element"],
    ['<html><head><meta name="robots" content="noindex,nofollow"></head><body>ok</body></html>', "already present"],
  ])("sets content-length to the served body byte length after noindex injection (%s)", async (html) => {
    const response = await fetchServedFile("index.html", html, { noindex: true });
    const served = await response.text();
    const expected = new TextEncoder().encode(served).byteLength;
    expect(response.headers.get("content-length")).toBe(String(expected));
  });

  it("keeps content-length matching the raw body for non-HTML noindex assets", async () => {
    const css = "body{color:red}";
    const response = await fetchServedFile("style.css", css, { noindex: true });
    const served = await response.text();
    expect(served).toBe(css);
    expect(response.headers.get("content-length")).toBe(String(new TextEncoder().encode(css).byteLength));
  });

  it("serves signed HEAD metadata under the artifact read limit", async () => {
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
    const rateLimitKeys: string[] = [];
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "index.html",
      plaintext: "<h1>ok</h1>",
    });
    const env = baseContentEnv({
      ARTIFACTS: {
        async get() {
          throw new Error("HEAD should use R2 head when available");
        },
        async head(key) {
          expect(key).toBe("artifacts/art_1/revisions/rev_1/files/index.html");
          return {
            body: null,
            size: stored.size,
            customMetadata: stored.customMetadata,
          };
        },
      },
      ARTIFACT_RATE_LIMIT: {
        async limit({ key }) {
          rateLimitKeys.push(key);
          return { success: true };
        },
      },
    });

    const response = await handleRequest(
      new Request(`https://content.test/v/${token}/index.html`, { method: "HEAD" }),
      env,
    );

    expect(response.status).toBe(200);
    expect(rateLimitKeys).toEqual(["art_1"]);
    expect(response.headers.get("content-length")).toBe("11");
    await expect(response.text()).resolves.toBe("");
  });

  it("drops content-length on a noindex HTML HEAD so it cannot understate the injected GET body", async () => {
    const token = await signContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["index.html"],
        noindex: true,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "index.html",
      plaintext: "<html><head></head><body>ok</body></html>",
    });
    const env = baseContentEnv({
      ARTIFACTS: {
        async get() {
          throw new Error("HEAD should use R2 head when available");
        },
        async head() {
          return { body: null, size: stored.size, customMetadata: stored.customMetadata };
        },
      },
    });

    const response = await handleRequest(
      new Request(`https://content.test/v/${token}/index.html`, { method: "HEAD" }),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.has("content-length")).toBe(false);
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
    const env = baseContentEnv({
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
    });

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
    const env = baseContentEnv({
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
    });

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
    const envForDenyKey = (denyKey: string): Env =>
      baseContentEnv({
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

  it("fails closed when the artifact rate-limit binding fails", async () => {
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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "index.html",
      plaintext: "<h1>ok</h1>",
    });
    const env = baseContentEnv({
      ARTIFACTS: {
        async get() {
          return stored;
        },
      },
      ARTIFACT_RATE_LIMIT: {
        async limit() {
          throw new Error("rate limit unavailable");
        },
      },
    });

    try {
      const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);

      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "rate_limited_artifact" } });
      expect(warn).toHaveBeenCalledWith("Rate limit artifact binding failed; denying request.", expect.any(Error));
    } finally {
      warn.mockRestore();
    }
  });

  it("checks ADR 0057 artifact and revision denylist keys without a token-hash key", async () => {
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
    const checkedKeys: string[] = [];
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "index.html",
      plaintext: "<h1>ok</h1>",
    });
    const env = baseContentEnv({
      DENYLIST: {
        async get(key) {
          checkedKeys.push(key);
          return null;
        },
      },
      ARTIFACTS: {
        async get() {
          return stored;
        },
      },
    });

    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);

    expect(response.status).toBe(200);
    expect(checkedKeys).toEqual(["wsd:00000000-0000-4000-8000-000000000001", "ad:art_1", "rd:rev_1"]);
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
    const env = baseContentEnv({
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
    });

    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);

    expect(response.status).toBe(404);
    expect(checkedKeys).toEqual(["wsd:00000000-0000-4000-8000-000000000001", "ad:art_1", "rd:rev_1", "ald:al_1"]);
  });

  it("ignores client-provided R2 content type metadata", async () => {
    const token = await signContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["notes.txt"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "notes.txt",
      plaintext: "<script>alert(1)</script>",
    });
    const env = baseContentEnv({
      ARTIFACTS: {
        async get() {
          return {
            ...stored,
            httpMetadata: { contentType: "text/html" },
            writeHttpMetadata(headers: Headers) {
              headers.set("content-type", "text/html");
            },
          };
        },
      },
    });

    const response = await handleRequest(new Request(`https://content.test/v/${token}/notes.txt`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("forces unknown extensions to download", async () => {
    const token = await signContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["payload.bin"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "payload.bin",
      plaintext: "opaque",
    });
    const env = baseContentEnv({
      ARTIFACTS: {
        async get() {
          return {
            ...stored,
            httpMetadata: { contentType: "text/html" },
          };
        },
      },
    });

    const response = await handleRequest(new Request(`https://content.test/v/${token}/payload.bin`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="payload.bin"');
  });

  it("uses the strict SVG CSP override", async () => {
    const token = await signContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["chart.svg"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "chart.svg",
      plaintext: "<svg></svg>",
    });
    const env = baseContentEnv({
      ARTIFACTS: {
        async get() {
          return stored;
        },
      },
    });

    const response = await handleRequest(new Request(`https://content.test/v/${token}/chart.svg`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    );
  });

  it("serves signed bundle downloads from /b/{token} using key_prefix", async () => {
    const bundleKey =
      "env/dev/workspaces/00000000-0000-4000-8000-000000000001/artifacts/art_1/revisions/rev_1/bundle.zip";
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        workspace_id: "00000000-0000-4000-8000-000000000001",
        key_prefix: bundleKey,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const encryptedBundle = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("zip-bytes"),
      rootSecret: artifactBytesEncryptionEnv.ARTIFACT_BYTES_ENCRYPTION_KEY,
      kid: 1,
      context: {
        workspaceId,
        artifactId: "art_1",
        revisionId: "rev_1",
        normalizedPath: "bundle.zip",
      },
    });
    const env = baseContentEnv({
      ARTIFACTS: {
        async get(key) {
          expect(key).toBe(bundleKey);
          return {
            body: new Blob([encryptedBundle.ciphertext]).stream(),
            size: encryptedBundle.ciphertext.byteLength,
            customMetadata: encryptedBundle.customMetadata,
          };
        },
      },
    });

    const response = await handleRequest(new Request(`https://content.test/b/${token}`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="bundle.zip"');
    await expect(response.text()).resolves.toBe("zip-bytes");
  });

  it("rejects bundle tokens without workspace_id before reading R2", async () => {
    const bundleKey =
      "env/dev/workspaces/00000000-0000-4000-8000-000000000001/artifacts/art_1/revisions/rev_1/bundle.zip";
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        key_prefix: bundleKey,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const get = vi.fn();
    const env = baseContentEnv({ ARTIFACTS: { get } });

    const response = await handleRequest(new Request(`https://content.test/b/${token}`), env);

    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects bundle tokens whose key_prefix does not match the derived bundle key", async () => {
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        workspace_id: workspaceId,
        key_prefix: "env/dev/workspaces/other/artifacts/art_1/revisions/rev_1/bundle.zip",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const get = vi.fn();
    const env = baseContentEnv({ ARTIFACTS: { get } });

    const response = await handleRequest(new Request(`https://content.test/b/${token}`), env);

    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
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
    const env = baseContentEnv({
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
    });

    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);
    expect(response.status).toBe(404);
  });

  it("returns not_found when ciphertext cannot be decrypted", async () => {
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
    const env = baseContentEnv({
      ARTIFACTS: {
        async get() {
          return {
            body: new Response("not-encrypted").body,
            size: 42,
            customMetadata: {
              enc_kid: "1",
              enc_alg: "aes-256-gcm",
              enc_aad_v: "v1",
            },
          };
        },
      },
    });

    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);
    expect(response.status).toBe(404);
  });
});

describe("artifact bytes encrypt→store→read fidelity", () => {
  it("serves decrypted plaintext from an encryptArtifactBytes fixture", async () => {
    const plaintext = "content-fidelity-marker";
    const fixture = await seedEncryptedRevisionFile({
      workspaceId,
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "marker.txt",
      plaintext,
    });
    const token = await signContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["marker.txt"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const env = baseContentEnv({
      ...sharedTestEncryptionEnv,
      ARTIFACTS: {
        async get(key) {
          expect(key).toBe(fixture.objectKey);
          return {
            body: new Blob([fixture.body]).stream(),
            size: fixture.body.byteLength,
            customMetadata: fixture.customMetadata,
          };
        },
      },
    });

    const response = await handleRequest(new Request(`https://content.test/v/${token}/marker.txt`), env);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(plaintext);
  });
});

describe("content conditional requests", () => {
  async function tokenFor(path: string, overrides: Partial<Parameters<typeof signContentToken>[0]> = {}) {
    return signContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: [path],
        exp: Math.floor(Date.now() / 1000) + 60,
        ...overrides,
      },
      "secret",
    );
  }

  async function cssEnv(): Promise<{ env: Env; get: ReturnType<typeof vi.fn> }> {
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "style.css",
      plaintext: "body{}",
    });
    const get = vi.fn(async () => stored);
    return { env: baseContentEnv({ ARTIFACTS: { get } }), get };
  }

  it("sets a strong ETag on a 200 file response", async () => {
    const response = await fetchServedFile("style.css", "body{}");
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("returns 304 without reading R2 when If-None-Match matches", async () => {
    const token = await tokenFor("style.css");
    const { env, get } = await cssEnv();
    const first = await handleRequest(new Request(`https://content.test/v/${token}/style.css`), env);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(1);

    const conditional = await handleRequest(
      new Request(`https://content.test/v/${token}/style.css`, { headers: { "if-none-match": etag as string } }),
      env,
    );

    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
    expect(conditional.headers.get("etag")).toBe(etag);
    expect(conditional.headers.get("cache-control")).toBe("private, no-cache");
    // The matching conditional request never touched R2.
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("keeps opaque-origin CORS headers on matching 304 responses", async () => {
    const token = await tokenFor("data/latest.json");
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "data/latest.json",
      plaintext: '{"ok":true}',
    });
    const get = vi.fn(async () => stored);
    const env = baseContentEnv({ ARTIFACTS: { get } });
    const first = await handleRequest(
      new Request(`https://content.test/v/${token}/data/latest.json`, { headers: { origin: "null" } }),
      env,
    );
    const etag = first.headers.get("etag");

    const conditional = await handleRequest(
      new Request(`https://content.test/v/${token}/data/latest.json`, {
        headers: { "if-none-match": etag as string, origin: "null" },
      }),
      env,
    );

    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("access-control-allow-origin")).toBe("null");
    expect(conditional.headers.get("vary")).toBe("Origin");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("returns the body when If-None-Match does not match", async () => {
    const token = await tokenFor("style.css");
    const { env, get } = await cssEnv();
    const response = await handleRequest(
      new Request(`https://content.test/v/${token}/style.css`, { headers: { "if-none-match": '"stale"' } }),
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("body{}");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("treats If-None-Match: * as a match", async () => {
    const token = await tokenFor("style.css");
    const { env, get } = await cssEnv();
    const response = await handleRequest(
      new Request(`https://content.test/v/${token}/style.css`, { headers: { "if-none-match": "*" } }),
      env,
    );
    expect(response.status).toBe(304);
    expect(get).not.toHaveBeenCalled();
  });

  it("404s a workspace-less token even when If-None-Match would match, mirroring the 200 path", async () => {
    // A token minted without workspace_id is unservable: the 200 path 404s when
    // prepareEncryptedObjectResponse sees no workspace, so the conditional path
    // must 404 too instead of short-circuiting to a 304.
    const token = await tokenFor("style.css", { workspace_id: undefined });
    const { env } = await cssEnv();
    const etag = await contentEtag("rev_1", "style.css");
    const response = await handleRequest(
      new Request(`https://content.test/v/${token}/style.css`, { headers: { "if-none-match": etag } }),
      env,
    );
    expect(response.status).toBe(404);
  });

  it("serves HTML with a no-cache directive and a matching HEAD ETag", async () => {
    const getResponse = await fetchServedFile("index.html", "<h1>ok</h1>");
    expect(getResponse.headers.get("cache-control")).toBe("private, no-cache");
    const etag = getResponse.headers.get("etag");

    const token = await tokenFor("index.html");
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "index.html",
      plaintext: "<h1>ok</h1>",
    });
    const head = vi.fn(async () => ({ body: null, size: stored.size, customMetadata: stored.customMetadata }));
    const env = baseContentEnv({
      ARTIFACTS: {
        async get() {
          throw new Error("HEAD should use R2 head");
        },
        head,
      },
    });
    const headResponse = await handleRequest(
      new Request(`https://content.test/v/${token}/index.html`, { method: "HEAD" }),
      env,
    );
    expect(headResponse.headers.get("etag")).toBe(etag);

    const conditionalHead = await handleRequest(
      new Request(`https://content.test/v/${token}/index.html`, {
        method: "HEAD",
        headers: { "if-none-match": etag as string },
      }),
      env,
    );
    expect(conditionalHead.status).toBe(304);
    expect(head).toHaveBeenCalledTimes(1);
  });

  it("carries the same locked-down headers on a 304 as the 200 it revalidates", async () => {
    // A 304 replaces the cached response's headers (RFC 9111 §4.3.4), so the
    // revalidation must not hand back a weaker CSP/content-type than the 200.
    const token = await tokenFor("index.html");
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "index.html",
      plaintext: "<h1>ok</h1>",
    });
    const get = vi.fn(async () => stored);
    const env = baseContentEnv({ ARTIFACTS: { get } });

    const first = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);
    const etag = first.headers.get("etag");
    expect(first.status).toBe(200);
    expect(first.headers.get("content-security-policy")).toContain("script-src 'none'");

    const conditional = await handleRequest(
      new Request(`https://content.test/v/${token}/index.html`, { headers: { "if-none-match": etag as string } }),
      env,
    );

    expect(conditional.status).toBe(304);
    // Locked-down, per-path headers survive the 304 instead of regressing to the
    // permissive base policy.
    expect(conditional.headers.get("content-security-policy")).toBe(first.headers.get("content-security-policy"));
    expect(conditional.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(conditional.headers.get("content-type")).toBe(first.headers.get("content-type"));
    expect(conditional.headers.get("cache-control")).toBe(first.headers.get("cache-control"));
    expect(conditional.headers.get("cache-control")).toBe("private, no-cache");
    // A 304 has no body, so it must not advertise a content-length.
    expect(conditional.headers.get("content-length")).toBeNull();
  });

  it("preserves the strict SVG CSP on a 304", async () => {
    const token = await tokenFor("chart.svg");
    const stored = await encryptedArtifactObject({
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "chart.svg",
      plaintext: "<svg></svg>",
    });
    const get = vi.fn(async () => stored);
    const env = baseContentEnv({ ARTIFACTS: { get } });

    const first = await handleRequest(new Request(`https://content.test/v/${token}/chart.svg`), env);
    const etag = first.headers.get("etag");
    const conditional = await handleRequest(
      new Request(`https://content.test/v/${token}/chart.svg`, { headers: { "if-none-match": etag as string } }),
      env,
    );

    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    );
    expect(conditional.headers.get("content-security-policy")).toBe(first.headers.get("content-security-policy"));
  });

  it("sets an ETag on bundle downloads and 304s a matching request without reading R2", async () => {
    const bundleKey =
      "env/dev/workspaces/00000000-0000-4000-8000-000000000001/artifacts/art_1/revisions/rev_1/bundle.zip";
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        workspace_id: workspaceId,
        key_prefix: bundleKey,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const encryptedBundle = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("zip-bytes"),
      rootSecret: artifactBytesEncryptionEnv.ARTIFACT_BYTES_ENCRYPTION_KEY,
      kid: 1,
      context: { workspaceId, artifactId: "art_1", revisionId: "rev_1", normalizedPath: "bundle.zip" },
    });
    const get = vi.fn(async () => ({
      body: new Blob([encryptedBundle.ciphertext]).stream(),
      size: encryptedBundle.ciphertext.byteLength,
      customMetadata: encryptedBundle.customMetadata,
    }));
    const env = baseContentEnv({ ARTIFACTS: { get } });

    const first = await handleRequest(new Request(`https://content.test/b/${token}`), env);
    const etag = first.headers.get("etag");
    expect(first.status).toBe(200);
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(get).toHaveBeenCalledTimes(1);

    const conditional = await handleRequest(
      new Request(`https://content.test/b/${token}`, { headers: { "if-none-match": etag as string } }),
      env,
    );
    expect(conditional.status).toBe(304);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("still 404s a denylisted token even when If-None-Match would match", async () => {
    const token = await tokenFor("style.css");
    const etag = (await fetchServedFile("style.css", "body{}")).headers.get("etag");
    const get = vi.fn();
    const env = baseContentEnv({
      DENYLIST: {
        async get(key) {
          return key === "ad:art_1" ? "1" : null;
        },
      },
      ARTIFACTS: { get },
    });
    const response = await handleRequest(
      new Request(`https://content.test/v/${token}/style.css`, { headers: { "if-none-match": etag as string } }),
      env,
    );
    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it("keeps the 304 path behind the artifact rate limit", async () => {
    const token = await tokenFor("style.css");
    const etag = (await fetchServedFile("style.css", "body{}")).headers.get("etag");
    const get = vi.fn();
    const limit = vi.fn(async () => ({ success: true }));
    const env = baseContentEnv({ ARTIFACTS: { get }, ARTIFACT_RATE_LIMIT: { limit } });
    const response = await handleRequest(
      new Request(`https://content.test/v/${token}/style.css`, { headers: { "if-none-match": etag as string } }),
      env,
    );
    expect(response.status).toBe(304);
    expect(limit).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("CSP header per content type", () => {
  it("pins direct HTML to the script-disabled CSP", async () => {
    const response = await fetchServedFile("index.html");
    expect(response.headers.get("content-security-policy")).toMatchInlineSnapshot(
      `"default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"`,
    );
  });

  it("pins viewer-framed HTML to the interactive CSP", async () => {
    const response = await fetchServedFile("index.html", "ok", { script_disabled: false }, viewerFrameHeaders, {
      AGENT_PASTE_ENV: "production",
    });
    expect(response.headers.get("content-security-policy")).toMatchInlineSnapshot(
      `"default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors https://app.agent-paste.sh"`,
    );
  });

  it("pins the CSS CSP", async () => {
    const response = await fetchServedFile("styles.css");
    expect(response.headers.get("content-security-policy")).toMatchInlineSnapshot(
      `"default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"`,
    );
  });

  it("pins the JS CSP", async () => {
    const response = await fetchServedFile("app.js");
    expect(response.headers.get("content-security-policy")).toMatchInlineSnapshot(
      `"default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"`,
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
      `"default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"`,
    );
  });

  it("pins the script-disabled HTML CSP for ephemeral-tier tokens", async () => {
    const response = await fetchServedFile("index.html", "ok", { script_disabled: true, noindex: true });
    expect(response.headers.get("content-security-policy")).toMatchInlineSnapshot(
      `"default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"`,
    );
  });

  it("fails closed to script-disabled when the token omits script_disabled", async () => {
    const response = await fetchServedFile("index.html", "ok", {});
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(response.headers.get("content-security-policy")).not.toContain("unsafe-eval");
  });
});
