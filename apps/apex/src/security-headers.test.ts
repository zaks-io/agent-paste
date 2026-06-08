import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { THEME_INIT_JS } from "./app/scripts";
import { apexCsp, apexSecurityHeaders, THEME_INIT_SHA256 } from "./security-headers";

describe("apex static CSP", () => {
  const csp = apexCsp();

  it("locks the document and framing down", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it("allows only self, the theme-init hash, and the analytics beacon for scripts", () => {
    expect(csp).toContain(`script-src 'self' '${THEME_INIT_SHA256}' https://static.cloudflareinsights.com`);
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("connect-src 'self' https://cloudflareinsights.com");
  });

  it("is strictly stronger than the old nonce policy: no nonces, strict-dynamic, or unsafe-inline", () => {
    // Everything is an external hashed asset now (CSS + the enhancement script);
    // the only inline script is the fixed theme-init, trusted by its hash.
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("nonce-");
    expect(csp).not.toContain("strict-dynamic");
  });

  it("stamps the baseline worker headers alongside the CSP", () => {
    const headers = new Headers(apexSecurityHeaders());
    expect(headers.get("content-security-policy")).toBe(csp);
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
  });
});

describe("theme-init hash drift guard", () => {
  it("THEME_INIT_SHA256 matches the byte-for-byte sha256 of THEME_INIT_JS", () => {
    // The CSP trusts the inline pre-paint script solely by this hash. If the
    // script body changes without re-pinning the hash, the browser blocks it and
    // returning visitors flash the wrong theme. Recompute here so drift fails
    // loudly in CI instead of silently at runtime.
    const computed = `sha256-${createHash("sha256").update(THEME_INIT_JS, "utf8").digest("base64")}`;
    expect(computed).toBe(THEME_INIT_SHA256);
  });
});
