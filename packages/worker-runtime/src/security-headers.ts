import type { MiddlewareHandler } from "hono";

// Baseline security headers applied to every Worker response regardless of
// content type. Excludes Content-Security-Policy (content-type specific, set per
// Worker), Cross-Origin-Resource-Policy (content-only), and cache-control /
// content-type (owned by the response builders). Never includes
// Access-Control-Allow-* (ADR 0014: no permissive CORS).
export const BASELINE_SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
} as const;

// Hono finalizing middleware: after the handler runs, sets baseline headers on
// the outgoing response when absent. Covers routes that bypass the bound
// responders (healthz, openapi, JSON-RPC, notFound/onError) in one line.
export function securityHeadersMiddleware(): MiddlewareHandler {
  return async (context, next) => {
    await next();
    setBaselineHeadersIfAbsent(context.res.headers);
  };
}

// A response that opens framing to a trusted origin does so via CSP
// `frame-ancestors`, which modern browsers honor over the legacy, origin-blind
// `X-Frame-Options`. Stamping `DENY` here would re-block that frame, so skip the
// XFO baseline whenever the handler set a `frame-ancestors` that is not 'none'.
function frameAncestorsAllowsFraming(headers: Headers): boolean {
  const csp = headers.get("content-security-policy");
  if (!csp) {
    return false;
  }
  const directive = csp
    .split(";")
    .map((segment) => segment.trim())
    .find((segment) => segment.toLowerCase().startsWith("frame-ancestors"));
  if (!directive) {
    return false;
  }
  const value = directive.slice("frame-ancestors".length).trim();
  return value.length > 0 && value.toLowerCase() !== "'none'";
}

function setBaselineHeadersIfAbsent(headers: Headers): void {
  const framingOpenedByCsp = frameAncestorsAllowsFraming(headers);
  for (const [name, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
    if (framingOpenedByCsp && name === "X-Frame-Options") {
      continue;
    }
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  }
}

// A fresh base64 CSP nonce (16 random bytes) for a single response. Uses Web
// Crypto + btoa, both available in Workers and the browser. The same value
// stamps script-src/style-src in the CSP header and the nonce='…' on the
// scripts/styles the response renders.
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
