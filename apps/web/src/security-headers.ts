import { BASELINE_SECURITY_HEADERS } from "@agent-paste/worker-runtime";

function dashboardCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.ingest.us.sentry.io https://cloudflareinsights.com",
    "frame-src https://challenges.cloudflare.com",
  ].join("; ");
}

export function applyDashboardSecurityHeaders(response: Response, nonce: string): Response {
  return withResponseHeaders(response, {
    ...BASELINE_SECURITY_HEADERS,
    "content-security-policy": dashboardCsp(nonce),
  });
}

export function withResponseHeaders(response: Response, extra: HeadersInit): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of new Headers(extra)) {
    const existing = headers.get(key);
    headers.set(key, key.toLowerCase() === "cache-control" ? mergeCacheControl(value, existing) : value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function mergeCacheControl(primary: string, secondary: string | null): string {
  const directives = new Map<string, string>();
  for (const value of [primary, secondary]) {
    if (!value) continue;
    for (const directive of value.split(",")) {
      const trimmed = directive.trim();
      if (!trimmed) continue;
      const name = trimmed.split("=", 1)[0]?.trim().toLowerCase();
      if (name && !directives.has(name)) directives.set(name, trimmed);
    }
  }
  return [...directives.values()].join(", ");
}
