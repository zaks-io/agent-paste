import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BASELINE_SECURITY_HEADERS, generateCspNonce, securityHeadersMiddleware } from "./security-headers.js";

describe("BASELINE_SECURITY_HEADERS", () => {
  it("carries the expected hardened header set", () => {
    expect(BASELINE_SECURITY_HEADERS).toEqual({
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
  });

  it("omits response-owned and CORS headers", () => {
    const names = Object.keys(BASELINE_SECURITY_HEADERS).map((name) => name.toLowerCase());
    expect(names).not.toContain("cache-control");
    expect(names).not.toContain("content-type");
    expect(names).not.toContain("content-security-policy");
    expect(names).not.toContain("cross-origin-resource-policy");
    expect(names.some((name) => name.startsWith("access-control-allow-"))).toBe(false);
  });
});

describe("securityHeadersMiddleware", () => {
  it("sets the baseline on outgoing Hono responses", async () => {
    const app = new Hono();
    app.use("*", securityHeadersMiddleware());
    app.get("/ok", (context) => context.json({ ok: true }));

    const response = await app.fetch(new Request("https://worker.test/ok"));

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("preserves a header the route already set", async () => {
    const app = new Hono();
    app.use("*", securityHeadersMiddleware());
    app.get("/strict", (context) => {
      context.header("referrer-policy", "no-referrer");
      return context.json({ ok: true });
    });

    const response = await app.fetch(new Request("https://worker.test/strict"));
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("covers notFound responses", async () => {
    const app = new Hono();
    app.use("*", securityHeadersMiddleware());
    app.notFound((context) => context.json({ error: "not_found" }, 404));

    const response = await app.fetch(new Request("https://worker.test/missing"));
    expect(response.status).toBe(404);
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
  });
});

describe("generateCspNonce", () => {
  it("returns base64 of 16 random bytes", () => {
    const nonce = generateCspNonce();
    const bytes = Uint8Array.from(atob(nonce), (char) => char.charCodeAt(0));
    expect(bytes).toHaveLength(16);
  });

  it("mints a fresh value each call", () => {
    expect(generateCspNonce()).not.toBe(generateCspNonce());
  });
});
