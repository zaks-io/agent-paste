import {
  seedEncryptedRevisionFile,
  testArtifactBytesEncryptionEnv,
} from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import { mintContentToken } from "@agent-paste/tokens/content";
import { contentCapabilityObjectKey, serializeContentCapabilityManifest } from "@agent-paste/tokens/content-capability";
import { describe, expect, it, vi } from "vitest";
import type { Env, R2ObjectBody } from "./env.js";
import { handleRequest } from "./index.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const capabilityId = "00112233445566778899aabbccddeeff";
const capabilityDomain = "content.example.test";
const capabilityOrigin = `https://${capabilityId}.${capabilityDomain}`;
async function capabilityFixture(input?: {
  accessLinkId?: string;
  expiresAt?: number | null;
  manifest?: string;
  scriptDisabled?: boolean;
}) {
  const paths = ["index.html", "page2.html", "assets/app.js"];
  const token = await mintContentToken(
    {
      workspace_id: workspaceId,
      artifact_id: "art_1",
      revision_id: "rev_1",
      ...(input?.accessLinkId ? { access_link_id: input.accessLinkId } : {}),
      paths,
      script_disabled: input?.scriptDisabled ?? false,
      exp: input && "expiresAt" in input ? (input.expiresAt ?? null) : Math.floor(Date.now() / 1000) + 60,
    },
    "secret",
  );
  const manifest =
    input?.manifest ??
    serializeContentCapabilityManifest({
      version: 1,
      signed_token: token,
      entrypoint: "index.html",
      revision_number: 1,
      artifact_updated_at: "2026-08-24T00:00:00.000Z",
    });
  const files = await Promise.all([
    seedEncryptedRevisionFile({
      workspaceId,
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "index.html",
      plaintext: '<a href="/page2.html">next</a><script src="/assets/app.js"></script>',
    }),
    seedEncryptedRevisionFile({
      workspaceId,
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "page2.html",
      plaintext: "<h1>page two</h1>",
    }),
    seedEncryptedRevisionFile({
      workspaceId,
      artifactId: "art_1",
      revisionId: "rev_1",
      path: "assets/app.js",
      plaintext: "globalThis.loaded = true;",
    }),
  ]);
  const objects = new Map<string, () => R2ObjectBody>();
  const manifestBytes = new TextEncoder().encode(manifest);
  objects.set(contentCapabilityObjectKey(capabilityId), () => ({
    body: new Blob([manifestBytes]).stream(),
    size: manifestBytes.byteLength,
  }));
  for (const file of files) {
    objects.set(file.objectKey, () => ({
      body: new Blob([file.body]).stream(),
      size: file.body.byteLength,
      customMetadata: file.customMetadata,
    }));
  }
  const get = vi.fn(async (key: string) => objects.get(key)?.() ?? null);
  const env: Env = {
    CONTENT_SIGNING_SECRET: "secret",
    CONTENT_CAPABILITY_DOMAIN: capabilityDomain,
    CONTENT_BASE_URL: "https://usercontent.example.test",
    AGENT_PASTE_ENV: "production",
    ...testArtifactBytesEncryptionEnv,
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
    ARTIFACTS: { get },
  };
  return { env, get };
}

describe("content capability routing", () => {
  it("serves the entrypoint at root and root-relative files from one capability origin", async () => {
    const { env } = await capabilityFixture();

    const entrypoint = await handleRequest(new Request(`${capabilityOrigin}/`), env);
    const pageTwo = await handleRequest(new Request(`${capabilityOrigin}/page2.html`), env);
    const script = await handleRequest(new Request(`${capabilityOrigin}/assets/app.js`), env);

    expect(entrypoint.status).toBe(200);
    const entrypointBody = await entrypoint.text();
    expect(entrypointBody).toContain('href="/page2.html"');
    expect(pageTwo.status).toBe(200);
    await expect(pageTwo.text()).resolves.toContain("page two");
    expect(script.status).toBe(200);
    await expect(script.text()).resolves.toContain("loaded");
    expect(pageTwo.headers.get("content-security-policy")).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:",
    );
    expect(entrypoint.headers.get("x-frame-options")).toBe("DENY");
    expect(entrypointBody).not.toContain("agent-paste:viewer-height");
  });

  it("keeps ephemeral capability content static", async () => {
    const { env } = await capabilityFixture({ scriptDisabled: true });

    const response = await handleRequest(new Request(`${capabilityOrigin}/`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("worker-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("form-action 'none'");
    expect(response.headers.get("content-security-policy")).toContain("frame-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("object-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("base-uri 'none'");
  });

  it("retires service workers on every current and legacy artifact host without reading storage", async () => {
    const { env } = await capabilityFixture();
    env.CONTENT_LEGACY_CAPABILITY_DOMAIN = "legacy.example.test";
    env.CONTENT_LEGACY_BASE_URL = "https://usercontent.legacy.example.test";
    env.ARTIFACTS = { get: vi.fn(async () => null) };

    for (const origin of [
      capabilityOrigin,
      `https://${capabilityId}.legacy.example.test`,
      "https://usercontent.example.test",
      "https://usercontent.legacy.example.test",
    ]) {
      const response = await handleRequest(
        new Request(`${origin}/sw.js`, { headers: { "Service-Worker": "script" } }),
        env,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("clear-site-data")).toBe('"cache", "cookies", "storage"');
      await expect(response.text()).resolves.toContain("registration.unregister");
    }
    expect(env.ARTIFACTS.get).not.toHaveBeenCalled();
  });

  it("redirects legacy capability hosts to the same path and query on the content domain", async () => {
    const { env } = await capabilityFixture();
    env.CONTENT_LEGACY_CAPABILITY_DOMAIN = "legacy.example.test";

    const response = await handleRequest(
      new Request(`http://${capabilityId}.legacy.example.test/docs/readme.html?mode=raw`),
      env,
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      `https://${capabilityId}.${capabilityDomain}/docs/readme.html?mode=raw`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed when current and legacy capability domains are equal", async () => {
    const { env } = await capabilityFixture();
    env.CONTENT_LEGACY_CAPABILITY_DOMAIN = capabilityDomain;

    const response = await handleRequest(new Request(`${capabilityOrigin}/`), env);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "internal_error" } });
  });

  it("accepts non-expiring tokens only after capability-host resolution", async () => {
    const { env } = await capabilityFixture({ expiresAt: null });
    const capabilityResponse = await handleRequest(new Request(`${capabilityOrigin}/index.html`), env);
    expect(capabilityResponse.status).toBe(200);

    const manifestObject = await env.ARTIFACTS.get(contentCapabilityObjectKey(capabilityId));
    const manifest = manifestObject?.body ? JSON.parse(await new Response(manifestObject.body).text()) : null;
    const legacyResponse = await handleRequest(
      new Request(`https://usercontent.example.test/v/${manifest?.signed_token ?? ""}/index.html`),
      env,
    );
    expect(legacyResponse.status).toBe(404);
  });

  it("reuses the signed token denylist checks for selective Access Link revocation", async () => {
    const { env, get } = await capabilityFixture({ accessLinkId: "al_1" });
    env.DENYLIST = {
      async get(key) {
        return key === "ald:al_1" ? "1" : null;
      },
    };

    const response = await handleRequest(new Request(`${capabilityOrigin}/index.html`), env);

    expect(response.status).toBe(404);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("rejects expired capabilities before reading artifact bytes", async () => {
    const { env, get } = await capabilityFixture({ expiresAt: Math.floor(Date.now() / 1000) - 1 });

    const response = await handleRequest(new Request(`${capabilityOrigin}/index.html`), env);

    expect(response.status).toBe(404);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("returns the generic not-found boundary for malformed capability hosts and manifests", async () => {
    const fixture = await capabilityFixture({ manifest: "not-json" });
    fixture.env.CONTENT_ROUTE_ORIGIN_HOSTS = "api.example.test";
    const fetchOrigin = vi.fn();
    const malformedManifest = await handleRequest(new Request(`${capabilityOrigin}/index.html`), fixture.env);
    const malformedHost = await handleRequest(
      new Request(`https://invalid.${capabilityDomain}/healthz`),
      fixture.env,
      fetchOrigin,
    );

    expect(malformedManifest.status).toBe(404);
    expect(malformedHost.status).toBe(404);
    expect(fetchOrigin).not.toHaveBeenCalled();
    await expect(malformedHost.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("forwards explicit product hosts to their Custom Domain origins", async () => {
    const { env } = await capabilityFixture();
    env.CONTENT_ROUTE_ORIGIN_HOSTS = "api.example.test,app.example.test";
    const fetchOrigin = vi.fn(async () => new Response("api ok", { headers: { "x-product-origin": "api" } }));
    const request = new Request("https://api.example.test/healthz");

    const response = await handleRequest(request, env, fetchOrigin);

    expect(fetchOrigin).toHaveBeenCalledOnce();
    expect(fetchOrigin).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-product-origin")).toBe("api");
    expect(response.headers.get("content-security-policy")).toBeNull();
    await expect(response.text()).resolves.toBe("api ok");
  });

  it("forwards only the bounded per-PR web hostname shape", async () => {
    const { env } = await capabilityFixture();
    env.CONTENT_ROUTE_PR_PREVIEW_DOMAIN = "preview.agent-paste.sh";
    const fetchOrigin = vi.fn(async () => new Response("preview ok"));

    const response = await handleRequest(
      new Request("https://pr-617.preview.agent-paste.sh/auth/callback"),
      env,
      fetchOrigin,
    );

    expect(response.status).toBe(200);
    expect(fetchOrigin).toHaveBeenCalledOnce();

    for (const hostname of [
      "pr-0.preview.agent-paste.sh",
      "pr-01.preview.agent-paste.sh",
      "pr-main.preview.agent-paste.sh",
      "pr-617.attacker.preview.agent-paste.sh",
    ]) {
      const rejected = await handleRequest(new Request(`https://${hostname}/auth/callback`), env, fetchOrigin);
      expect(rejected.status).toBe(404);
    }
    expect(fetchOrigin).toHaveBeenCalledOnce();
  });

  it("fails closed when the product-origin host configuration is malformed", async () => {
    const { env } = await capabilityFixture();
    env.CONTENT_ROUTE_ORIGIN_HOSTS = "api.example.test,invalid.example.test/path";
    const fetchOrigin = vi.fn();

    const response = await handleRequest(new Request("https://api.example.test/healthz"), env, fetchOrigin);

    expect(fetchOrigin).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "internal_error" } });
  });

  it("fails closed when the per-PR preview domain is malformed", async () => {
    const { env } = await capabilityFixture();
    env.CONTENT_ROUTE_PR_PREVIEW_DOMAIN = "preview.agent-paste.sh/path";
    const fetchOrigin = vi.fn();

    const response = await handleRequest(
      new Request("https://pr-617.preview.agent-paste.sh/auth/callback"),
      env,
      fetchOrigin,
    );

    expect(fetchOrigin).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "internal_error" } });
  });

  it("returns the standard internal-error envelope when manifest storage fails", async () => {
    const { env } = await capabilityFixture();
    env.ARTIFACTS = {
      async get() {
        throw new Error("manifest storage unavailable");
      },
    };

    const response = await handleRequest(
      new Request(`${capabilityOrigin}/index.html`, { headers: { "x-request-id": "capability-error-123" } }),
      env,
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("capability-error-123");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "internal_error", request_id: "capability-error-123" },
    });
  });

  it("keeps legacy signed URLs working when capability hosting is configured", async () => {
    const { env } = await capabilityFixture();
    const token = await mintContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["page2.html"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );

    const response = await handleRequest(new Request(`https://usercontent.example.test/v/${token}/page2.html`), env);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("page two");
  });

  it("keeps signed URLs on an explicitly configured legacy base host working", async () => {
    const { env } = await capabilityFixture();
    env.CONTENT_LEGACY_BASE_URL = "https://usercontent.legacy.example.test";
    const token = await mintContentToken(
      {
        workspace_id: workspaceId,
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["page2.html"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );

    const response = await handleRequest(
      new Request(`https://usercontent.legacy.example.test/v/${token}/page2.html`),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("page two");
  });
});
