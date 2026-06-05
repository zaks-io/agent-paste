import { BASELINE_SECURITY_HEADERS } from "@agent-paste/worker-runtime";

// Enforcing CSP for the apex marketing site. Both script-src and style-src are
// nonce-based with no 'unsafe-inline': apex renders a fixed set of inline assets
// we control (one clipboard helper script, one <style> block, the CF Analytics
// beacon), so a per-request nonce covers them all. 'strict-dynamic' lets the
// nonce'd beacon load without a host allowlist.
export function apexCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'nonce-${nonce}'`,
    "font-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "connect-src 'self' https://cloudflareinsights.com",
  ].join("; ");
}

export function apexSecurityHeaders(nonce: string): HeadersInit {
  return {
    ...BASELINE_SECURITY_HEADERS,
    "content-security-policy": apexCsp(nonce),
  };
}
