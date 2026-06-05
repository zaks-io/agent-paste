import type { ContentTokenPayload } from "@agent-paste/tokens/content";
import { describe, expect, it } from "vitest";
import type { Env } from "./env.js";
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
} from "./serve-object.js";

const ETAG = '"test-etag"';

function basePayload(overrides: Partial<ContentTokenPayload> = {}): ContentTokenPayload {
  return {
    artifact_id: "art_1",
    revision_id: "rev_1",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

describe("serve-object path allowlist", () => {
  it("allows empty path only when key_prefix ends with bundle.zip", () => {
    expect(isAllowedPath("", basePayload({ key_prefix: "artifacts/a/revisions/r/bundle.zip" }))).toBe(true);
    expect(isAllowedPath("", basePayload({ key_prefix: "artifacts/a/revisions/r/files" }))).toBe(false);
    expect(isAllowedPath("", basePayload())).toBe(false);
  });

  it("rejects unsafe paths", () => {
    expect(isSafePath("../secret")).toBe(false);
    expect(isSafePath("/absolute")).toBe(false);
    expect(isSafePath("ok/nested")).toBe(true);
    expect(isAllowedPath("../x", basePayload({ paths: ["../x"] }))).toBe(false);
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

  it("opens framing to the app origin for inline content and drops XFO", () => {
    const headers = responseHeadersForPath("index.html", 3, basePayload({ script_disabled: false }), ETAG, [
      "https://app.agent-paste.sh",
    ]);
    expect(headers.get("content-security-policy")).toContain("frame-ancestors https://app.agent-paste.sh");
    expect(headers.get("content-security-policy")).not.toContain("frame-ancestors 'none'");
    expect(headers.get("x-frame-options")).toBeNull();
  });

  it("supports multiple framing origins", () => {
    const headers = responseHeadersForPath("index.html", 3, basePayload({ script_disabled: false }), ETAG, [
      "https://app.agent-paste.sh",
      "https://app.preview.agent-paste.sh",
    ]);
    expect(headers.get("content-security-policy")).toContain(
      "frame-ancestors https://app.agent-paste.sh https://app.preview.agent-paste.sh",
    );
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
