import { describe, expect, it } from "vitest";
import { applyDashboardSecurityHeaders, withResponseHeaders } from "../src/security-headers";

describe("web security headers", () => {
  it("allows only the Turnstile frame because Artifacts open top-level", () => {
    const response = applyDashboardSecurityHeaders(new Response("ok"), "nonce-value");
    const csp = response.headers.get("content-security-policy") ?? "";

    expect(csp).toContain("script-src 'nonce-nonce-value' 'strict-dynamic'");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).not.toContain("usercontent.agent-paste.sh");
    expect(csp).not.toContain("*.agent-paste.sh");
  });

  it("preserves response status and merges cache-control", () => {
    const response = withResponseHeaders(
      new Response("ok", { status: 201, headers: { "cache-control": "private, max-age=0" } }),
      { "cache-control": "no-store" },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store, private, max-age=0");
  });
});
