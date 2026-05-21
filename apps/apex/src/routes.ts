import { AGENTS_MD } from "./agents.js";
import { LLMS_TXT } from "./llms.js";
import { renderHomePage } from "./page.js";
import { APP_ORIGIN, productRedirect } from "./redirects.js";

const TEXT_PLAIN = "text/plain; charset=utf-8";
const TEXT_MARKDOWN = "text/markdown; charset=utf-8";
const TEXT_HTML = "text/html; charset=utf-8";
const TEXT_XML = "application/xml; charset=utf-8";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS: HeadersInit = {
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "interest-cohort=()",
  "content-security-policy": CSP,
};

const CACHE_HTML = "public, max-age=0, must-revalidate";
const CACHE_TEXT = "public, max-age=300, s-maxage=300";
const CACHE_XML = "public, max-age=3600, s-maxage=3600";

export function routeApex(request: Request): Response | null {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { allow: "GET, HEAD, OPTIONS" } });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method_not_allowed", {
      status: 405,
      headers: { allow: "GET, HEAD, OPTIONS", "content-type": TEXT_PLAIN, ...SECURITY_HEADERS },
    });
  }

  const redirectTarget = productRedirect(url);
  if (redirectTarget) {
    return new Response(null, {
      status: 308,
      headers: { location: redirectTarget, "cache-control": "no-store", ...SECURITY_HEADERS },
    });
  }

  if (url.pathname === "/") {
    return htmlResponse(renderHomePage(), request.method);
  }

  if (url.pathname === "/llms.txt") {
    return textResponse(LLMS_TXT, TEXT_PLAIN, request.method);
  }

  if (url.pathname === "/agents.md") {
    return textResponse(AGENTS_MD, TEXT_MARKDOWN, request.method);
  }

  if (url.pathname === "/robots.txt") {
    return textResponse(robotsTxt(url.origin), TEXT_PLAIN, request.method);
  }

  if (url.pathname === "/sitemap.xml") {
    return xmlResponse(sitemapXml(url.origin), request.method);
  }

  return null;
}

function htmlResponse(body: string, method: string): Response {
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: { "content-type": TEXT_HTML, "cache-control": CACHE_HTML, ...SECURITY_HEADERS },
  });
}

function textResponse(body: string, contentType: string, method: string): Response {
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: { "content-type": contentType, "cache-control": CACHE_TEXT, ...SECURITY_HEADERS },
  });
}

function xmlResponse(body: string, method: string): Response {
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: { "content-type": TEXT_XML, "cache-control": CACHE_XML, ...SECURITY_HEADERS },
  });
}

function robotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
}

function sitemapXml(origin: string): string {
  const urls = ["/", "/llms.txt", "/agents.md"];
  const entries = urls.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

export { APP_ORIGIN };
