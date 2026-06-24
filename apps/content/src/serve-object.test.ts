import { type RequestIdVariables, requestIdMiddleware } from "@agent-paste/auth";
import { encryptArtifactBytes, workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import type { ContentTokenPayload } from "@agent-paste/tokens/content";
import { type BoundRespondersVariables, boundRespondersMiddleware } from "@agent-paste/worker-runtime";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppContext, Env } from "./env.js";
import { contentEtag, etagMatches } from "./etag.js";
import {
  bundleResponseHeaders,
  CONTENT_CACHE_CONTROL,
  denylistKeysForPayload,
  injectNoindexMeta,
  isAllowedPath,
  isDenylisted,
  isHtmlPath,
  isSafePath,
  objectKeyFor,
  responseHeadersForPath,
  serveSignedObject,
} from "./serve-object.js";

const ETAG = '"test-etag"';
const workspaceId = "00000000-0000-4000-8000-000000000001";
const otherWorkspaceId = "00000000-0000-4000-8000-000000000002";
const artifactBytesEncryptionEnv = {
  ARTIFACT_BYTES_ENCRYPTION_KEY: "test-artifact-bytes-encryption-key",
};
const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

function basePayload(overrides: Partial<ContentTokenPayload> = {}): ContentTokenPayload {
  return {
    artifact_id: "art_1",
    revision_id: "rev_1",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

function objectServingApp(payload: ContentTokenPayload, path = "index.html") {
  const app = new Hono<{ Bindings: Env; Variables: RequestIdVariables & BoundRespondersVariables }>();
  app.use("*", requestIdMiddleware());
  app.use("*", boundRespondersMiddleware({ defaultErrorHeaders: () => ({}) }));
  app.get("/file", (context) => serveSignedObject(context as AppContext, payload, path));
  return app;
}

function viewerFrameRequest(): Request {
  return new Request("https://usercontent.agent-paste.sh/v/token/index.html", {
    headers: {
      "sec-fetch-dest": "iframe",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-site",
    },
  });
}

describe("serve-object path allowlist", () => {
  it("allows empty path only when key_prefix matches the derived bundle key", () => {
    expect(
      isAllowedPath(
        "",
        basePayload({
          workspace_id: "ws_1",
          key_prefix: "env/dev/workspaces/ws_1/artifacts/art_1/revisions/rev_1/bundle.zip",
        }),
      ),
    ).toBe(true);
    expect(isAllowedPath("", basePayload({ key_prefix: "artifacts/a/revisions/r/bundle.zip" }))).toBe(false);
    expect(isAllowedPath("", basePayload({ key_prefix: "artifacts/a/revisions/r/files" }))).toBe(false);
    expect(isAllowedPath("", basePayload())).toBe(false);
  });

  it("rejects unsafe paths", () => {
    expect(isSafePath("../secret")).toBe(false);
    expect(isSafePath("foo/./bar")).toBe(false);
    expect(isSafePath("foo//bar")).toBe(false);
    expect(isSafePath("foo\\bar")).toBe(false);
    expect(isSafePath("/absolute")).toBe(false);
    expect(isSafePath("ok/nested")).toBe(true);
    expect(isAllowedPath("../x", basePayload({ paths: ["../x"] }))).toBe(false);
  });

  it("rejects read-side key_prefix values outside the artifact revision files prefix", () => {
    expect(
      isAllowedPath(
        "index.html",
        basePayload({ key_prefix: "artifacts/art_1/revisions/rev_1/files", paths: ["index.html"] }),
      ),
    ).toBe(true);
    expect(isAllowedPath("index.html", basePayload({ key_prefix: "artifacts/other/revisions/rev_1/files" }))).toBe(
      false,
    );
    expect(isAllowedPath("index.html", basePayload({ key_prefix: "artifacts/art_1/revisions/rev_1" }))).toBe(false);
    expect(isAllowedPath("index.html", basePayload({ key_prefix: "artifacts/art_1/revisions/rev_1/files/.." }))).toBe(
      false,
    );
  });

  it("requires path to be listed when paths is set", () => {
    const payload = basePayload({ paths: ["index.html"] });
    expect(isAllowedPath("index.html", payload)).toBe(true);
    expect(isAllowedPath("other.html", payload)).toBe(false);
  });

  it("allows any safe path when paths is omitted", () => {
    expect(isAllowedPath("notes.txt", basePayload())).toBe(true);
  });
});

describe("serve-object denylist", () => {
  it("builds ADR 0057 keys with optional workspace and access link", () => {
    expect(denylistKeysForPayload(basePayload())).toEqual(["ad:art_1", "rd:rev_1"]);
    expect(
      denylistKeysForPayload(
        basePayload({
          workspace_id: "ws_1",
          access_link_id: "al_1",
        }),
      ),
    ).toEqual(["wsd:ws_1", "ad:art_1", "rd:rev_1", "ald:al_1"]);
  });

  it("returns true when any denylist key hits", async () => {
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get(key) {
          return key === "ad:art_1" ? "1" : null;
        },
      },
      ARTIFACTS: {
        async get() {
          return null;
        },
      },
    };
    expect(await isDenylisted(env, basePayload())).toBe(true);
  });
});

describe("serve-object response headers", () => {
  it("derives served content type from path extension, not claims", () => {
    const headers = responseHeadersForPath("notes.txt", 4, basePayload(), ETAG);
    expect(headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(headers.get("content-disposition")).toBeNull();
  });

  it("forces unknown extensions to attachment", () => {
    const headers = responseHeadersForPath("payload.bin", 6, basePayload(), ETAG);
    expect(headers.get("content-type")).toBe("application/octet-stream");
    expect(headers.get("content-disposition")).toBe('attachment; filename="payload.bin"');
  });

  it("applies strict SVG CSP override", () => {
    const headers = responseHeadersForPath("chart.svg", 10, basePayload(), ETAG);
    expect(headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  });

  it("fails closed to script-disabled when script_disabled is omitted", () => {
    const headers = responseHeadersForPath("index.html", 3, basePayload(), ETAG);
    expect(headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(headers.get("content-security-policy")).not.toContain("unsafe-eval");
  });

  it("sets bundle zip headers", () => {
    const headers = bundleResponseHeaders(100, false, ETAG);
    expect(headers.get("content-type")).toBe("application/zip");
    expect(headers.get("content-disposition")).toBe('attachment; filename="bundle.zip"');
  });

  it("allows opaque-origin sandbox fetches without opening ordinary browser origins", () => {
    const opaqueHeaders = responseHeadersForPath(
      "data/latest.json",
      4,
      basePayload(),
      ETAG,
      [],
      new Request("https://usercontent.agent-paste.sh/v/token/data/latest.json", {
        headers: { origin: "null" },
      }),
    );
    expect(opaqueHeaders.get("access-control-allow-origin")).toBe("null");
    expect(opaqueHeaders.get("vary")).toBe("Origin");

    const appOriginHeaders = responseHeadersForPath(
      "data/latest.json",
      4,
      basePayload(),
      ETAG,
      [],
      new Request("https://usercontent.agent-paste.sh/v/token/data/latest.json", {
        headers: { origin: "https://app.agent-paste.sh" },
      }),
    );
    expect(appOriginHeaders.get("access-control-allow-origin")).toBeNull();
  });

  it("sets the etag on file and bundle responses", () => {
    expect(responseHeadersForPath("notes.txt", 4, basePayload(), ETAG).get("etag")).toBe(ETAG);
    expect(bundleResponseHeaders(100, false, ETAG).get("etag")).toBe(ETAG);
  });

  it("revalidates every served file and the bundle on every load", () => {
    expect(responseHeadersForPath("index.html", 3, basePayload(), ETAG).get("cache-control")).toBe(
      CONTENT_CACHE_CONTROL,
    );
    expect(responseHeadersForPath("style.css", 3, basePayload(), ETAG).get("cache-control")).toBe(
      CONTENT_CACHE_CONTROL,
    );
    expect(responseHeadersForPath("logo.png", 3, basePayload(), ETAG).get("cache-control")).toBe(CONTENT_CACHE_CONTROL);
    expect(bundleResponseHeaders(100, false, ETAG).get("cache-control")).toBe(CONTENT_CACHE_CONTROL);
    expect(CONTENT_CACHE_CONTROL).toBe("private, no-cache");
  });

  it("opens framing to the app origin for viewer iframe requests and drops XFO", () => {
    const headers = responseHeadersForPath(
      "index.html",
      3,
      basePayload({ script_disabled: false }),
      ETAG,
      ["https://app.agent-paste.sh"],
      viewerFrameRequest(),
    );
    expect(headers.get("content-security-policy")).toContain("frame-ancestors https://app.agent-paste.sh");
    expect(headers.get("content-security-policy")).not.toContain("frame-ancestors 'none'");
    expect(headers.get("content-security-policy")).toContain("unsafe-eval");
    expect(headers.get("x-frame-options")).toBeNull();
  });

  it("supports multiple framing origins", () => {
    const headers = responseHeadersForPath(
      "index.html",
      3,
      basePayload({ script_disabled: false }),
      ETAG,
      ["https://app.agent-paste.sh", "https://app.preview.agent-paste.sh"],
      viewerFrameRequest(),
    );
    expect(headers.get("content-security-policy")).toContain(
      "frame-ancestors https://app.agent-paste.sh https://app.preview.agent-paste.sh",
    );
  });

  it("downgrades script-enabled tokens on direct usercontent navigations", () => {
    const headers = responseHeadersForPath(
      "index.html",
      3,
      basePayload({ script_disabled: false }),
      ETAG,
      ["https://app.agent-paste.sh"],
      new Request("https://usercontent.agent-paste.sh/v/token/index.html", {
        headers: {
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
        },
      }),
    );
    expect(headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("content-security-policy")).not.toContain("unsafe-eval");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  it("does not downgrade non-HTML byte responses", () => {
    const headers = responseHeadersForPath("app.js", 3, basePayload({ script_disabled: false }), ETAG, [
      "https://app.agent-paste.sh",
    ]);
    expect(headers.get("content-security-policy")).toContain("unsafe-eval");
    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  it("keeps viewer-framed script-disabled content inert", () => {
    const headers = responseHeadersForPath(
      "index.html",
      3,
      basePayload({ script_disabled: true }),
      ETAG,
      ["https://app.agent-paste.sh"],
      viewerFrameRequest(),
    );
    expect(headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(headers.get("content-security-policy")).toContain("frame-ancestors https://app.agent-paste.sh");
    expect(headers.get("x-frame-options")).toBeNull();
  });

  it("keeps attachments frame-denied even when framing origins are provided", () => {
    const headers = responseHeadersForPath("payload.bin", 6, basePayload(), ETAG, ["https://app.agent-paste.sh"]);
    expect(headers.get("content-disposition")).toBe('attachment; filename="payload.bin"');
    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  it("stays frame-denied for inline content when no framing origins are provided", () => {
    const headers = responseHeadersForPath("index.html", 3, basePayload({ script_disabled: false }), ETAG);
    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  it("carries the baseline plus the content security headers", () => {
    for (const headers of [
      responseHeadersForPath("notes.txt", 4, basePayload(), ETAG),
      bundleResponseHeaders(100, false, ETAG),
    ]) {
      // Baseline additions
      expect(headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
      expect(headers.get("x-frame-options")).toBe("DENY");
      // Content-specific headers still present and winning where they overlap
      expect(headers.get("referrer-policy")).toBe("no-referrer");
      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("cross-origin-resource-policy")).toBe("cross-origin");
      expect(headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      // No permissive CORS.
      expect(headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});

describe("serve-object noindex meta injection", () => {
  it("detects html paths", () => {
    expect(isHtmlPath("index.html")).toBe(true);
    expect(isHtmlPath("page.xhtml")).toBe(true);
    expect(isHtmlPath("app.js")).toBe(false);
  });

  it("injects meta into head or prepends when missing", () => {
    const tag = '<meta name="robots" content="noindex,nofollow">';
    expect(injectNoindexMeta("<html><head></head></html>")).toContain(tag);
    expect(injectNoindexMeta(`<html><head>${tag}</head></html>`)).toBe(`<html><head>${tag}</head></html>`);
    expect(injectNoindexMeta("<p>x</p>")).toBe(`${tag}<p>x</p>`);
  });
});

describe("serve-object object keys", () => {
  it("builds default artifact revision file keys", () => {
    expect(objectKeyFor(basePayload(), "index.html")).toBe("artifacts/art_1/revisions/rev_1/files/index.html");
  });

  it("serves signed workspace blob object keys with v2 artifact-byte AAD", async () => {
    const blobKey = workspaceBlobObjectKeyFor({ workspaceId, sha256: HELLO_SHA256 });
    const encrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("hello"),
      rootSecret: artifactBytesEncryptionEnv.ARTIFACT_BYTES_ENCRYPTION_KEY,
      kid: 1,
      context: { kind: "blob", workspaceId, sha256: HELLO_SHA256 },
    });
    const get = vi.fn(async (key: string) => {
      expect(key).toBe(blobKey);
      return {
        body: new Blob([encrypted.ciphertext]).stream(),
        size: encrypted.ciphertext.byteLength,
        customMetadata: encrypted.customMetadata,
      };
    });
    const response = await objectServingApp(
      basePayload({
        workspace_id: workspaceId,
        paths: ["index.html"],
        object_key: blobKey,
      }),
    ).fetch(new Request("https://content.test/file"), {
      CONTENT_SIGNING_SECRET: "secret",
      ...artifactBytesEncryptionEnv,
      DENYLIST: { get: async () => null },
      ARTIFACTS: { get },
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("hello");
  });

  it("resolves path-specific object key maps for multi-file revision URLs", () => {
    const indexKey = workspaceBlobObjectKeyFor({ workspaceId, sha256: HELLO_SHA256 });
    const assetKey = workspaceBlobObjectKeyFor({
      workspaceId,
      sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    expect(
      objectKeyFor(
        basePayload({
          workspace_id: workspaceId,
          paths: ["index.html", "assets/app.js"],
          object_keys: {
            "index.html": indexKey,
            "assets/app.js": assetKey,
          },
        }),
        "assets/app.js",
      ),
    ).toBe(assetKey);
  });

  it("rejects a single signed object key on multi-path tokens", async () => {
    const get = vi.fn(async () => null);
    const response = await objectServingApp(
      basePayload({
        workspace_id: workspaceId,
        paths: ["index.html", "assets/app.js"],
        object_key: workspaceBlobObjectKeyFor({ workspaceId, sha256: HELLO_SHA256 }),
      }),
      "assets/app.js",
    ).fetch(new Request("https://content.test/file"), {
      CONTENT_SIGNING_SECRET: "secret",
      ...artifactBytesEncryptionEnv,
      DENYLIST: { get: async () => null },
      ARTIFACTS: { get },
    });

    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects unsafe signed object keys before reading R2", async () => {
    const get = vi.fn(async () => null);
    const response = await objectServingApp(
      basePayload({
        workspace_id: workspaceId,
        paths: ["index.html"],
        object_key: workspaceBlobObjectKeyFor({ workspaceId: otherWorkspaceId, sha256: HELLO_SHA256 }),
      }),
    ).fetch(new Request("https://content.test/file"), {
      CONTENT_SIGNING_SECRET: "secret",
      ...artifactBytesEncryptionEnv,
      DENYLIST: { get: async () => null },
      ARTIFACTS: { get },
    });

    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it("serves destination workspace blob keys minted after claim reparent", async () => {
    const claimedWorkspaceId = "33333333-3333-3333-3333-333333333333";
    const blobKey = workspaceBlobObjectKeyFor({ workspaceId: claimedWorkspaceId, sha256: HELLO_SHA256 });
    const encrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("hello"),
      rootSecret: artifactBytesEncryptionEnv.ARTIFACT_BYTES_ENCRYPTION_KEY,
      kid: 1,
      context: { kind: "blob", workspaceId: claimedWorkspaceId, sha256: HELLO_SHA256 },
    });
    const get = vi.fn(async (key: string) => {
      expect(key).toBe(blobKey);
      return {
        body: new Blob([encrypted.ciphertext]).stream(),
        size: encrypted.ciphertext.byteLength,
        customMetadata: encrypted.customMetadata,
      };
    });
    const response = await objectServingApp(
      basePayload({
        workspace_id: claimedWorkspaceId,
        paths: ["index.html"],
        object_keys: { "index.html": blobKey },
        script_disabled: false,
      }),
    ).fetch(new Request("https://content.test/file"), {
      CONTENT_SIGNING_SECRET: "secret",
      ...artifactBytesEncryptionEnv,
      DENYLIST: { get: async () => null },
      ARTIFACTS: { get },
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("hello");
  });
});

describe("serve-object conditional responses", () => {
  it("rejects invalid key_prefix before a matching If-None-Match can 304", async () => {
    const get = vi.fn(async () => null);
    const app = new Hono<{ Bindings: Env; Variables: RequestIdVariables & BoundRespondersVariables }>();
    app.use("*", requestIdMiddleware());
    app.use("*", boundRespondersMiddleware({ defaultErrorHeaders: () => ({}) }));
    app.get("/file", (context) =>
      serveSignedObject(
        context as AppContext,
        basePayload({
          workspace_id: "ws_1",
          paths: ["index.html"],
          key_prefix: "artifacts/other/revisions/rev_1/files",
        }),
        "index.html",
      ),
    );

    const etag = await contentEtag("rev_1", "index.html");
    const response = await app.fetch(new Request("https://content.test/file", { headers: { "if-none-match": etag } }), {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: { get: async () => null },
      ARTIFACTS: { get },
    });

    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("content etag", () => {
  it("is a strong quoted validator stable for a given revision and path", async () => {
    const etag = await contentEtag("rev_1", "index.html");
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(await contentEtag("rev_1", "index.html")).toBe(etag);
  });

  it("differs across revision or path", async () => {
    const base = await contentEtag("rev_1", "index.html");
    expect(await contentEtag("rev_2", "index.html")).not.toBe(base);
    expect(await contentEtag("rev_1", "other.html")).not.toBe(base);
  });

  it("differs when the HTML representation variant changes", async () => {
    const base = await contentEtag("rev_1", "index.html");
    const viewer = await contentEtag("rev_1", "index.html", "viewer:resize:script-on");
    expect(viewer).not.toBe(base);
  });
});

describe("etagMatches", () => {
  it("returns false for missing or empty If-None-Match", () => {
    expect(etagMatches(null, ETAG)).toBe(false);
    expect(etagMatches("", ETAG)).toBe(false);
  });

  it("matches the wildcard", () => {
    expect(etagMatches("*", ETAG)).toBe(true);
  });

  it("matches an exact tag and a tag within a list", () => {
    expect(etagMatches(ETAG, ETAG)).toBe(true);
    expect(etagMatches(`"other", ${ETAG}`, ETAG)).toBe(true);
  });

  it("does not match a different tag", () => {
    expect(etagMatches('"other"', ETAG)).toBe(false);
  });

  it("compares weakly so W/ prefixes are ignored", () => {
    expect(etagMatches(`W/${ETAG}`, ETAG)).toBe(true);
  });
});
