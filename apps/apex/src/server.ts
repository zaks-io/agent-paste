import { GPC_SUPPORT_PATH, shouldDisableOptionalAnalytics } from "@agent-paste/brand";
import { isBillingEnabled } from "@agent-paste/config";
import { type AnalyticsEngineDataset, sentryOptions, writeFunnelEvent } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { textAssets } from "./build/text-assets";
import { productRedirect } from "./redirects";
import { apexSecurityHeaders } from "./security-headers";

export type Env = {
  AGENT_PASTE_ENV?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
  SENTRY_DSN?: string;
  CF_WEB_ANALYTICS_TOKEN?: string;
  BILLING_ENABLED?: string;
  FUNNEL_EVENTS?: AnalyticsEngineDataset;
};

const TEXT_PLAIN = "text/plain; charset=utf-8";
const CACHE_TEXT = "public, max-age=300, s-maxage=300";
const CACHE_XML = "public, max-age=3600, s-maxage=3600";

// The text/data assets the worker serves dynamically (everything else is
// prerendered HTML or a static file served via the ASSETS binding). Cheap
// membership check so the markdown/llms corpora are only rendered for the rare
// request that actually wants one.
const TEXT_ASSET_PATHS = new Set([
  "/docs.md",
  "/llms.txt",
  "/llms-full.txt",
  "/agents.md",
  "/install.sh",
  "/install.ps1",
  "/robots.txt",
  "/sitemap.xml",
  GPC_SUPPORT_PATH,
  "/.well-known/security.txt",
]);

const ANALYTICS_BEACON_SELECTOR = 'script[src="https://static.cloudflareinsights.com/beacon.min.js"]';
const FUNNEL_EVENTS_PATH = "/__funnel/events";
const CLAIM_CODE_PATTERN = /^clm_[0-9A-HJKMNP-TV-Z]{26}$/;
const PROMPT_VARIANT_PATTERN = /^[a-z0-9][a-z0-9_:-]{0,79}$/;

export function isTextAssetPath(pathname: string): boolean {
  return TEXT_ASSET_PATHS.has(pathname) || /^\/docs\/[^/]+\.md$/.test(pathname);
}

const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export default Sentry.withSentry((env: Env) => sentryOptions(env), worker);

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const security = apexSecurityHeaders() as Record<string, string>;

  if (url.pathname === FUNNEL_EVENTS_PATH) {
    return handleFunnelEvent(request, env, security);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { allow: "GET, HEAD, OPTIONS" } });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method_not_allowed", {
      status: 405,
      headers: { allow: "GET, HEAD, OPTIONS", "content-type": TEXT_PLAIN, ...security },
    });
  }

  const redirectTarget = productRedirect(url);
  if (redirectTarget) {
    return new Response(null, {
      status: 308,
      headers: { location: redirectTarget, "cache-control": "no-store", ...security },
    });
  }

  if (url.pathname === "/healthz") {
    return new Response("ok", { status: 200, headers: { "content-type": TEXT_PLAIN } });
  }

  if (isTextAssetPath(url.pathname)) {
    const billingEnabled = isBillingEnabled(env.BILLING_ENABLED);
    const asset = textAssets({ origin: url.origin, billingEnabled }).find((entry) => entry.path === url.pathname);
    if (asset) {
      const cacheControl = asset.contentType.startsWith("application/xml") ? CACHE_XML : CACHE_TEXT;
      return new Response(request.method === "HEAD" ? null : asset.body, {
        status: 200,
        headers: { "content-type": asset.contentType, "cache-control": cacheControl, ...security },
      });
    }
  }

  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) {
    const headers = new Headers(assetResponse.headers);
    for (const [name, value] of Object.entries(security)) {
      headers.set(name, value as string);
    }
    const response = new Response(request.method === "HEAD" ? null : assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
    return maybeStripOptionalAnalytics(request, response);
  }

  return new Response("not_found", {
    status: 404,
    headers: { "content-type": TEXT_PLAIN, ...security },
  });
}

async function handleFunnelEvent(request: Request, env: Env, security: Record<string, string>): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { allow: "POST, OPTIONS", ...security } });
  }
  if (request.method !== "POST") {
    return new Response("method_not_allowed", {
      status: 405,
      headers: { allow: "POST, OPTIONS", "content-type": TEXT_PLAIN, ...security },
    });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("invalid_json", { status: 400, headers: { "content-type": TEXT_PLAIN, ...security } });
  }
  if (!body || typeof body !== "object") {
    return new Response("invalid_event", { status: 400, headers: { "content-type": TEXT_PLAIN, ...security } });
  }
  const event = body as { event?: unknown; claim_code?: unknown; prompt_variant?: unknown };
  if (
    event.event !== "prompt_copied" ||
    typeof event.claim_code !== "string" ||
    !CLAIM_CODE_PATTERN.test(event.claim_code) ||
    typeof event.prompt_variant !== "string" ||
    !PROMPT_VARIANT_PATTERN.test(event.prompt_variant)
  ) {
    return new Response("invalid_event", { status: 400, headers: { "content-type": TEXT_PLAIN, ...security } });
  }

  writeFunnelEvent(env.FUNNEL_EVENTS, {
    kind: "prompt_copied",
    surface: "apex",
    claimCode: event.claim_code,
    promptVariant: event.prompt_variant,
  });
  return new Response(null, { status: 204, headers: { "cache-control": "no-store", ...security } });
}

function maybeStripOptionalAnalytics(request: Request, response: Response): Response {
  if (
    request.method === "HEAD" ||
    !isHtmlResponse(response) ||
    !shouldDisableOptionalAnalytics({ getHeader: (name) => request.headers.get(name) })
  ) {
    return response;
  }
  return new HTMLRewriter()
    .on(ANALYTICS_BEACON_SELECTOR, {
      element(element) {
        element.remove();
      },
    })
    .transform(response);
}

function isHtmlResponse(response: Response): boolean {
  return response.headers.get("content-type")?.toLowerCase().includes("text/html") ?? false;
}
