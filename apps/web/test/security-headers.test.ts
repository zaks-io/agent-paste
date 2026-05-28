import { describe, expect, it } from "vitest";
import {
  accessLinkProxyHeaders,
  accessLinkSecurityHeadersForPath,
  accessLinkViewerHeaders,
  applyAccessLinkSecurityHeaders,
} from "../src/security-headers";

const productionEnv = {
  AGENT_PASTE_ENV: "production" as const,
  CONTENT_BASE_URL: "https://usercontent.agent-paste.sh/v/example/index.html",
};

describe("Access Link security headers", () => {
  it("sets a viewer CSP that allows only app scripts, app fetches, and the content origin frame", () => {
    const headers = accessLinkViewerHeaders(productionEnv);
    const csp = headers.get("content-security-policy") ?? "";

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
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
    expect(accessLinkSecurityHeadersForPath("/al/pub_1", productionEnv)?.get("content-security-policy")).toContain(
      "frame-src https://usercontent.agent-paste.sh",
    );
    expect(accessLinkSecurityHeadersForPath("/api/access-links/resolve")?.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(accessLinkSecurityHeadersForPath("/api/live/access-links/pub_1")?.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(accessLinkSecurityHeadersForPath("/dashboard")).toBeNull();
    expect(accessLinkSecurityHeadersForPath("/api/live/artifacts/art_1")).toBeNull();
  });

  it("applies Access Link headers without dropping existing response headers", async () => {
    const response = applyAccessLinkSecurityHeaders(
      new Request("https://app.test/al/pub_1"),
      new Response("ok", {
        status: 201,
        headers: { "content-type": "text/html; charset=utf-8", "x-existing": "yes" },
      }),
      productionEnv,
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
    );

    expect(response.headers.get("cache-control")).toBe("no-store, no-cache, no-transform");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });
});
