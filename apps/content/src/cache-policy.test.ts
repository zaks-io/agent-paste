import { describe, expect, it } from "vitest";
import { CONTENT_CACHE_CONTROL, contentCacheControl } from "./cache-policy.js";

const base = { disposition: "inline" as const, exp: null, nowSeconds: 1000 };

describe("content browser caching", () => {
  it.each([
    "image/png",
    "image/svg+xml",
    "font/woff2",
    "audio/mpeg",
    "video/mp4",
    "text/css; charset=utf-8",
    "application/javascript; charset=utf-8",
  ])("reuses inline %s for one hour", (contentType) => {
    expect(contentCacheControl({ ...base, contentType })).toBe("private, max-age=3600, must-revalidate, no-transform");
  });

  it.each([
    "text/html; charset=utf-8",
    "application/json",
    "text/plain",
    "text/markdown",
    "application/pdf",
    "application/octet-stream",
    "application/zip",
  ])("revalidates %s on every load", (contentType) => {
    expect(contentCacheControl({ ...base, contentType })).toBe(CONTENT_CACHE_CONTROL);
  });

  it("revalidates attachments even with a static MIME type", () => {
    expect(contentCacheControl({ ...base, contentType: "image/png", disposition: "attachment" })).toBe(
      CONTENT_CACHE_CONTROL,
    );
  });

  it.each([
    [1120, 120],
    [1300, 300],
    [5000, 3600],
  ])("caps freshness for expiry %s", (exp, maxAge) => {
    expect(contentCacheControl({ ...base, contentType: "image/png", exp })).toBe(
      `private, max-age=${maxAge}, must-revalidate, no-transform`,
    );
  });

  it.each([999, 1000])("does not grant freshness at or after expiry %s", (exp) => {
    expect(contentCacheControl({ ...base, contentType: "image/png", exp })).toBe(CONTENT_CACHE_CONTROL);
  });
});
