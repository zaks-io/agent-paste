import { createHash } from "node:crypto";
import { BASELINE_SECURITY_HEADERS } from "@agent-paste/worker-runtime";
import { THEME_INIT_JS } from "./app/scripts";

// Static CSP for the prerendered apex site. The stylesheet and the one
// enhancement script are external hashed assets ('self'); the only inline script
// is the fixed pre-paint theme-init, allowed by its sha256 hash. No nonces and no
// 'unsafe-inline' anywhere, which is strictly stronger than the old nonce policy.
//
// The hash is DERIVED from THEME_INIT_JS at module load (node:crypto works in the
// apex Worker under nodejs_compat), so the CSP can never drift from the script —
// no hand-pinned constant to forget to update. computed once, not per request.
export const THEME_INIT_SHA256 = `sha256-${createHash("sha256").update(THEME_INIT_JS, "utf8").digest("base64")}`;

const BEACON_HOST = "https://static.cloudflareinsights.com";
const SENTRY_INGEST_HOST = "https://*.ingest.us.sentry.io";

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
    `connect-src 'self' https://cloudflareinsights.com ${SENTRY_INGEST_HOST}`,
  ].join("; ");
}

export function apexSecurityHeaders(): HeadersInit {
  return {
    ...BASELINE_SECURITY_HEADERS,
    "content-security-policy": apexCsp(),
  };
}
