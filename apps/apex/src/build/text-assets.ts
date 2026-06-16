import { GPC_SUPPORT_BODY, GPC_SUPPORT_PATH } from "@agent-paste/brand";
import { AGENTS_MD } from "../agents";
import { renderDocsIndexMarkdown, renderDocsPageMarkdown, renderLlmsFullText } from "../docs/markdown";
import { DOCS_PAGES, docsHtmlPath, docsMarkdownPath } from "../docs/registry";
import { INSTALL_PS1 } from "../install-ps1";
import { INSTALL_SH } from "../install-sh";
import { renderLlmsTxt } from "../llms";

const TEXT_PLAIN = "text/plain; charset=utf-8";
const TEXT_MARKDOWN = "text/markdown; charset=utf-8";
const TEXT_XML = "application/xml; charset=utf-8";
const APPLICATION_JSON = "application/json; charset=utf-8";
const TEXT_SHELL = "text/x-shellscript; charset=utf-8";

export type TextAsset = { path: string; contentType: string; body: string };

export function textAssets(opts: { origin: string; billingEnabled: boolean }): TextAsset[] {
  return [
    { path: "/docs.md", contentType: TEXT_MARKDOWN, body: renderDocsIndexMarkdown() },
    ...DOCS_PAGES.map((page) => ({
      path: docsMarkdownPath(page),
      contentType: TEXT_MARKDOWN,
      body: renderDocsPageMarkdown(page),
    })),
    { path: "/llms-full.txt", contentType: TEXT_PLAIN, body: renderLlmsFullText() },
    { path: "/llms.txt", contentType: TEXT_PLAIN, body: renderLlmsTxt(opts.billingEnabled) },
    { path: "/agents.md", contentType: TEXT_MARKDOWN, body: AGENTS_MD },
    { path: "/install.sh", contentType: TEXT_SHELL, body: INSTALL_SH },
    { path: "/install.ps1", contentType: TEXT_PLAIN, body: INSTALL_PS1 },
    { path: "/robots.txt", contentType: TEXT_PLAIN, body: robotsTxt(opts.origin) },
    { path: GPC_SUPPORT_PATH, contentType: APPLICATION_JSON, body: GPC_SUPPORT_BODY },
    { path: "/.well-known/security.txt", contentType: TEXT_PLAIN, body: securityTxt() },
    { path: "/sitemap.xml", contentType: TEXT_XML, body: sitemapXml(opts.origin, opts.billingEnabled) },
  ];
}

function robotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
}

function securityTxt(): string {
  return [
    "Contact: mailto:support@agent-paste.sh",
    "Preferred-Languages: en",
    "Canonical: https://agent-paste.sh/.well-known/security.txt",
    "Expires: 2027-06-12T00:00:00Z",
    "",
  ].join("\n");
}

function sitemapXml(origin: string, billingEnabled: boolean): string {
  const urls = [
    "/",
    "/about",
    "/how-it-works",
    ...(billingEnabled ? ["/pricing"] : []),
    "/docs",
    "/docs.md",
    ...DOCS_PAGES.flatMap((page) => [docsHtmlPath(page), docsMarkdownPath(page)]),
    "/terms",
    "/privacy",
    "/llms.txt",
    "/llms-full.txt",
    "/agents.md",
  ];
  const entries = urls.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
