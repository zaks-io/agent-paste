import { describe, expect, it } from "vitest";
import {
  accessLinkProxyHeaders,
  accessLinkSecurityHeadersForPath,
  accessLinkViewerHeaders,
  applyAccessLinkSecurityHeaders,
  applyDashboardSecurityHeaders,
} from "../src/security-headers";

const productionEnv = {
  AGENT_PASTE_ENV: "production" as const,
  CONTENT_BASE_URL: "https://usercontent.agent-paste.sh/v/example/index.html",
};

describe("Access Link security headers", () => {
  const nonce = "dGVzdC1ub25jZS0xMjM0";

  it("sets a viewer CSP that allows nonce-stamped app scripts, app fetches, and the content origin frame", () => {
    const headers = accessLinkViewerHeaders(productionEnv, nonce);
    const csp = headers.get("content-security-policy") ?? "";

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-src https://usercontent.agent-paste.sh");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("frame-src http: https:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it("sets a tighter CSP for Access Link proxy responses", () => {
    const headers = accessLinkProxyHeaders({ "retry-after": "60" });
    const csp = headers.get("content-security-policy") ?? "";

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src");
    expect(headers.get("retry-after")).toBe("60");
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it("matches only Access Link viewer and proxy paths", () => {
    expect(
      accessLinkSecurityHeadersForPath("/al/pub_1", productionEnv, nonce)?.get("content-security-policy"),
    ).toContain("frame-src https://usercontent.agent-paste.sh");
    expect(
      accessLinkSecurityHeadersForPath("/api/access-links/resolve", undefined, nonce)?.get("content-security-policy"),
    ).toContain("default-src 'none'");
    expect(
      accessLinkSecurityHeadersForPath("/api/live/access-links/pub_1", undefined, nonce)?.get(
        "content-security-policy",
      ),
    ).toContain("default-src 'none'");
    expect(accessLinkSecurityHeadersForPath("/dashboard", undefined, nonce)).toBeNull();
    expect(accessLinkSecurityHeadersForPath("/api/live/artifacts/art_1", undefined, nonce)).toBeNull();
  });

  it("applies Access Link headers without dropping existing response headers", async () => {
    const response = applyAccessLinkSecurityHeaders(
      new Request("https://app.test/al/pub_1"),
      new Response("ok", {
        status: 201,
        headers: { "content-type": "text/html; charset=utf-8", "x-existing": "yes" },
      }),
      productionEnv,
      nonce,
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("x-existing")).toBe("yes");
    expect(response.headers.get("content-security-policy")).toContain("frame-src https://usercontent.agent-paste.sh");
    await expect(response.text()).resolves.toBe("ok");
  });

  it("merges no-store with live Access Link SSE cache directives", () => {
    const response = applyAccessLinkSecurityHeaders(
      new Request("https://app.test/api/live/access-links/pub_1"),
      new Response("event: ready\n\n", {
        headers: { "cache-control": "no-cache, no-transform", "content-type": "text/event-stream" },
      }),
      productionEnv,
      nonce,
    );

    expect(response.headers.get("cache-control")).toBe("no-store, no-cache, no-transform");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });
});

describe("Dashboard security headers", () => {
  const nonce = "dGVzdC1ub25jZS0xMjM0";

  it("applies the baseline and the enforcing dashboard CSP to a generic response", () => {
    const response = applyDashboardSecurityHeaders(
      new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      productionEnv,
      nonce,
    );

    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");

    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Nonce-based strict CSP: trusted inline scripts + strict-dynamic, no unsafe-inline.
    expect(csp).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp).not.toContain("'unsafe-inline' https://challenges.cloudflare.com");
    expect(csp.match(/script-src[^;]*'unsafe-inline'/)).toBeNull();
    // style-src still needs 'unsafe-inline' (SSR-injected <style>, no style nonce path).
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    // Sentry ingest host: the real DSN is o<org>.ingest.us.sentry.io, which a single
    // *.ingest.sentry.io wildcard does NOT match (two labels before ingest).
    expect(csp).toContain("https://*.ingest.us.sentry.io");
    expect(csp).toContain("https://cloudflareinsights.com");
    // The artifact viewer iframe loads from the content origin, so frame-src must allow it.
    expect(csp).toContain("frame-src https://challenges.cloudflare.com https://usercontent.agent-paste.sh");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("lets the access-link CSP win when layered after the dashboard headers", () => {
    const request = new Request("https://app.test/al/pub_1");
    const baselined = applyDashboardSecurityHeaders(
      new Response("ok", { headers: { "content-type": "text/html; charset=utf-8" } }),
      productionEnv,
      nonce,
    );
    const response = applyAccessLinkSecurityHeaders(request, baselined, productionEnv, nonce);

    // Access-link routes keep their stricter CSP and referrer policy.
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-src https://usercontent.agent-paste.sh");
    expect(csp).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    // Baseline still present where access-link does not override.
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
});
