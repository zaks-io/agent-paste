import { BASELINE_SECURITY_HEADERS } from "@agent-paste/worker-runtime";

// Static CSP for the prerendered apex site. The stylesheet and the one
// enhancement script are external hashed assets ('self'); the only inline script
// is the fixed pre-paint theme-init, allowed by its sha256 hash. No nonces and no
// 'unsafe-inline' anywhere, which is strictly stronger than the old nonce policy.
//
// THEME_INIT_SHA256 MUST match THEME_INIT_JS (apps/apex/src/app/scripts.ts)
// byte-for-byte; security-headers.test.ts recomputes the hash and fails on drift.
export const THEME_INIT_SHA256 = "sha256-EvYsRVn3eeHUA7+/EFOzuQUFA2JZcSUS2m51fpJd2U4=";

const BEACON_HOST = "https://static.cloudflareinsights.com";

export function apexCsp(): string {
  return [
    "default-src 'self'",
    `script-src 'self' '${THEME_INIT_SHA256}' ${BEACON_HOST}`,
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "connect-src 'self' https://cloudflareinsights.com",
  ].join("; ");
}

export function apexSecurityHeaders(): HeadersInit {
  return {
    ...BASELINE_SECURITY_HEADERS,
    "content-security-policy": apexCsp(),
  };
}
