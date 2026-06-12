import { BASELINE_SECURITY_HEADERS } from "@agent-paste/worker-runtime";
import type { WebEnv } from "./server/env";

type AccessLinkSecurityEnv = Pick<WebEnv, "AGENT_PASTE_ENV" | "CONTENT_BASE_URL">;

// Enforcing CSP for the authenticated dashboard. script-src uses a per-request
// nonce + 'strict-dynamic': TanStack Start stamps the nonce onto every script it
// renders (hydration scripts and the head() scripts, including the CF Analytics
// beacon), and 'strict-dynamic' lets those trusted scripts pull in the code-split
// app chunks plus the Turnstile/Sentry loaders without a host allowlist.
// style-src keeps 'unsafe-inline' because React/Tailwind SSR injects inline
// <style> and there is no style-nonce path (not a script-XSS vector; see
// docs/ops/web-csp-todo.md). frame-src allows the Turnstile widget plus the
// content origin (the artifact viewer iframe).
function dashboardCsp(nonce: string, env?: AccessLinkSecurityEnv): string {
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
    `frame-src https://challenges.cloudflare.com ${contentFrameSrc(env)}`,
  ].join("; ");
}

const DEFAULT_CONTENT_FRAME_SRC = "https://usercontent.agent-paste.sh";
const DEV_CONTENT_FRAME_SRC = "http://127.0.0.1:8789";

const ACCESS_LINK_VIEWER_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
];

const ACCESS_LINK_PROXY_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const COMMON_SECURITY_HEADERS = {
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
} as const;

export function accessLinkViewerHeaders(env: AccessLinkSecurityEnv | undefined, nonce: string): Headers {
  return securityHeaders({
    "content-security-policy": viewerCsp(nonce, env),
    "cache-control": "no-store",
  });
}

export function accessLinkProxyHeaders(extra?: HeadersInit): Headers {
  return securityHeaders({
    "content-security-policy": ACCESS_LINK_PROXY_CSP,
    "cache-control": "no-store",
    ...headersObject(extra),
  });
}

// Copies the streamable response headers (content-type, cache-control) from an
// upstream Live Updates response onto a caller-provided base set of headers.
export function liveStreamProxyHeaders(upstream: Headers, base: Headers): Headers {
  for (const name of ["content-type", "cache-control"]) {
    const value = upstream.get(name);
    if (value) {
      base.set(name, value);
    }
  }
  return base;
}

export function accessLinkSecurityHeadersForPath(
  pathname: string,
  env: AccessLinkSecurityEnv | undefined,
  nonce: string,
): Headers | null {
  if (isAccessLinkViewerPath(pathname)) {
    return accessLinkViewerHeaders(env, nonce);
  }
  if (isAccessLinkProxyPath(pathname)) {
    return accessLinkProxyHeaders();
  }
  return null;
}

export function applyAccessLinkSecurityHeaders(
  request: Request,
  response: Response,
  env: AccessLinkSecurityEnv | undefined,
  nonce: string,
): Response {
  const headers = accessLinkSecurityHeadersForPath(new URL(request.url).pathname, env, nonce);
  return headers ? withResponseHeaders(response, headers) : response;
}

// Baseline security headers + the enforcing dashboard CSP, applied to every
// response. The nonce must match the one handed to handler.fetch so the CSP
// trusts the scripts TanStack Start stamped. Access-link routes layer their
// stricter CSP/referrer on top afterward (see applyAccessLinkSecurityHeaders),
// so those values win there.
export function applyDashboardSecurityHeaders(
  response: Response,
  env: AccessLinkSecurityEnv | undefined,
  nonce: string,
): Response {
  return withResponseHeaders(response, {
    ...BASELINE_SECURITY_HEADERS,
    "content-security-policy": dashboardCsp(nonce, env),
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

function securityHeaders(extra: Record<string, string>): Headers {
  return new Headers({
    ...COMMON_SECURITY_HEADERS,
    ...extra,
  });
}

function viewerCsp(nonce: string, env?: AccessLinkSecurityEnv): string {
  return [
    ...ACCESS_LINK_VIEWER_CSP,
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    `frame-src ${contentFrameSrc(env)}`,
  ].join("; ");
}

function contentFrameSrc(env?: AccessLinkSecurityEnv): string {
  const configured = env?.CONTENT_BASE_URL ? originSource(env.CONTENT_BASE_URL) : null;
  if (configured) {
    return configured;
  }
  if (env?.AGENT_PASTE_ENV === "dev") {
    return DEV_CONTENT_FRAME_SRC;
  }
  return DEFAULT_CONTENT_FRAME_SRC;
}

function originSource(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function mergeCacheControl(primary: string, secondary: string | null): string {
  const directives = new Map<string, string>();
  for (const value of [primary, secondary]) {
    if (!value) {
      continue;
    }
    for (const directive of value.split(",")) {
      const trimmed = directive.trim();
      if (!trimmed) {
        continue;
      }
      const name = trimmed.split("=", 1)[0]?.trim().toLowerCase();
      if (name && !directives.has(name)) {
        directives.set(name, trimmed);
      }
    }
  }
  return [...directives.values()].join(", ");
}

function headersObject(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) {
    return result;
  }
  for (const [key, value] of new Headers(headers)) {
    result[key] = value;
  }
  return result;
}

function isAccessLinkViewerPath(pathname: string): boolean {
  return /^\/al\/[^/]+\/?$/.test(pathname);
}

function isAccessLinkProxyPath(pathname: string): boolean {
  return pathname === "/api/access-links/resolve" || /^\/api\/live\/access-links\/[^/]+\/?$/.test(pathname);
}
