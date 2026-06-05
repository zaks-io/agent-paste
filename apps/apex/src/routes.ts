import { AGENTS_MD } from "./agents.js";
import { renderAboutPage } from "./components/about.js";
import { renderDocsIndexPage, renderDocsPage } from "./components/docs.js";
import { renderHomePage } from "./components/home.js";
import { renderDocsIndexMarkdown, renderDocsPageMarkdown, renderLlmsFullText } from "./docs/markdown.js";
import { DOCS_PAGES, docsHtmlPath, docsMarkdownPath, docsPageForSlug } from "./docs/registry.js";
import { INSTALL_PS1 } from "./install-ps1.js";
import { INSTALL_SH } from "./install-sh.js";
import { legalDocumentForPath, renderLegalPage } from "./legal.js";
import { LLMS_TXT } from "./llms.js";
import { APP_ORIGIN, productRedirect } from "./redirects.js";
import { apexSecurityHeaders } from "./security-headers.js";

const TEXT_PLAIN = "text/plain; charset=utf-8";
const TEXT_MARKDOWN = "text/markdown; charset=utf-8";
const TEXT_HTML = "text/html; charset=utf-8";
const TEXT_XML = "application/xml; charset=utf-8";
const TEXT_SHELL = "text/x-shellscript; charset=utf-8";

const CACHE_HTML = "public, max-age=0, must-revalidate";
const CACHE_TEXT = "public, max-age=300, s-maxage=300";
const CACHE_XML = "public, max-age=3600, s-maxage=3600";

export type ApexRouteContext = {
  nonce: string;
  analyticsToken?: string | undefined;
};

export function routeApex(request: Request, context: ApexRouteContext): Response | null {
  const url = new URL(request.url);
  const security = apexSecurityHeaders(context.nonce);

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

  if (url.pathname === "/") {
    return htmlResponse(renderHomePage(context.nonce, context.analyticsToken), request.method, security);
  }

  if (url.pathname === "/about") {
    return htmlResponse(renderAboutPage(context.nonce, context.analyticsToken), request.method, security);
  }

  if (url.pathname === "/docs") {
    return htmlResponse(renderDocsIndexPage(context.nonce, context.analyticsToken), request.method, security);
  }

  if (url.pathname === "/docs.md") {
    return textResponse(renderDocsIndexMarkdown(), TEXT_MARKDOWN, request.method, security);
  }

  if (url.pathname === "/llms-full.txt") {
    return textResponse(renderLlmsFullText(), TEXT_PLAIN, request.method, security);
  }

  const docsRoute = docsRouteForPath(url.pathname);
  if (docsRoute?.kind === "html") {
    return htmlResponse(
      renderDocsPage(docsRoute.page, context.nonce, context.analyticsToken),
      request.method,
      security,
    );
  }
  if (docsRoute?.kind === "markdown") {
    return textResponse(renderDocsPageMarkdown(docsRoute.page), TEXT_MARKDOWN, request.method, security);
  }

  const legalDocument = legalDocumentForPath(url.pathname);
  if (legalDocument) {
    return htmlResponse(
      renderLegalPage(legalDocument, context.nonce, context.analyticsToken),
      request.method,
      security,
    );
  }

  if (url.pathname === "/llms.txt") {
    return textResponse(LLMS_TXT, TEXT_PLAIN, request.method, security);
  }

  if (url.pathname === "/agents.md") {
    return textResponse(AGENTS_MD, TEXT_MARKDOWN, request.method, security);
  }

  if (url.pathname === "/install.sh") {
    return textResponse(INSTALL_SH, TEXT_SHELL, request.method, security);
  }

  if (url.pathname === "/install.ps1") {
    return textResponse(INSTALL_PS1, TEXT_PLAIN, request.method, security);
  }

  if (url.pathname === "/robots.txt") {
    return textResponse(robotsTxt(url.origin), TEXT_PLAIN, request.method, security);
  }

  if (url.pathname === "/sitemap.xml") {
    return xmlResponse(sitemapXml(url.origin), request.method, security);
  }

  if (url.pathname === "/healthz") {
    return new Response("ok", {
      status: 200,
      headers: { "content-type": TEXT_PLAIN },
    });
  }

  return null;
}

function htmlResponse(body: string, method: string, security: HeadersInit): Response {
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: { "content-type": TEXT_HTML, "cache-control": CACHE_HTML, ...security },
  });
}

function textResponse(body: string, contentType: string, method: string, security: HeadersInit): Response {
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: { "content-type": contentType, "cache-control": CACHE_TEXT, ...security },
  });
}

function xmlResponse(body: string, method: string, security: HeadersInit): Response {
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: { "content-type": TEXT_XML, "cache-control": CACHE_XML, ...security },
  });
}

function robotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
}

function sitemapXml(origin: string): string {
  const urls = [
    "/",
    "/about",
    "/docs",
    "/docs.md",
    ...DOCS_PAGES.flatMap((page) => [docsHtmlPath(page), docsMarkdownPath(page)]),
    "/terms",
    "/privacy",
    "/llms.txt",
    "/llms-full.txt",
    "/agents.md",
    "/install.sh",
    "/install.ps1",
  ];
  const entries = urls.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

function docsRouteForPath(pathname: string): {
  kind: "html" | "markdown";
  page: NonNullable<ReturnType<typeof docsPageForSlug>>;
} | null {
  const match = pathname.match(/^\/docs\/([^/]+?)(\.md)?$/);
  if (!match) {
    return null;
  }
  const slug = match[1];
  if (!slug) {
    return null;
  }
  const page = docsPageForSlug(slug);
  if (!page) {
    return null;
  }
  return { kind: match[2] ? "markdown" : "html", page };
}

export { APP_ORIGIN };
