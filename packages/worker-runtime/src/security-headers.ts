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

function setBaselineHeadersIfAbsent(headers: Headers): void {
  for (const [name, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
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
