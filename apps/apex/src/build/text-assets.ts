import { GPC_SUPPORT_BODY, GPC_SUPPORT_PATH } from "@agent-paste/brand";
import { AGENTS_MD } from "../agents";
import { API_CATALOG_CONTENT_TYPE, API_CATALOG_PATH, apiCatalogDocument } from "../discovery";
import { renderDocsIndexMarkdown, renderDocsPageMarkdown, renderLlmsFullText } from "../docs/markdown";
import { docsHtmlPath, docsMarkdownPath, docsPagesForBilling } from "../docs/registry";
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
  const docsPages = docsPagesForBilling(opts.billingEnabled);
  return [
    { path: "/docs.md", contentType: TEXT_MARKDOWN, body: renderDocsIndexMarkdown(docsPages) },
    ...docsPages.map((page) => ({
      path: docsMarkdownPath(page),
      contentType: TEXT_MARKDOWN,
      body: renderDocsPageMarkdown(page),
    })),
    { path: "/llms-full.txt", contentType: TEXT_PLAIN, body: renderLlmsFullText(docsPages) },
    { path: "/llms.txt", contentType: TEXT_PLAIN, body: renderLlmsTxt(opts.billingEnabled) },
    { path: "/agents.md", contentType: TEXT_MARKDOWN, body: AGENTS_MD },
    { path: "/install.sh", contentType: TEXT_SHELL, body: INSTALL_SH },
    { path: "/install.ps1", contentType: TEXT_PLAIN, body: INSTALL_PS1 },
    { path: "/robots.txt", contentType: TEXT_PLAIN, body: robotsTxt(opts.origin) },
    { path: GPC_SUPPORT_PATH, contentType: APPLICATION_JSON, body: GPC_SUPPORT_BODY },
    { path: "/.well-known/security.txt", contentType: TEXT_PLAIN, body: securityTxt() },
    { path: API_CATALOG_PATH, contentType: API_CATALOG_CONTENT_TYPE, body: apiCatalogDocument(opts.origin) },
    { path: "/sitemap.xml", contentType: TEXT_XML, body: sitemapXml(opts.origin, opts.billingEnabled) },
  ];
}

// Verbatim boilerplate from the Content Signals Policy generator at
// https://contentsignals.org/. It is the human-readable policy text that
// defines the signals below, so it is reproduced as-published rather than
// paraphrased.
const CONTENT_SIGNALS_PREAMBLE = `# As a condition of accessing this website, you agree to
# abide by the following content signals:

# (a)  If a content-signal = yes, you may collect content
# for the corresponding use.
# (b)  If a content-signal = no, you may not collect content
# for the corresponding use.
# (c)  If the website operator does not include a content
# signal for a corresponding use, the website operator
# neither grants nor restricts permission via content signal
# with respect to the corresponding use.

# The content signals and their meanings are:

# search: building a search index and providing search
# results (e.g., returning hyperlinks and short excerpts
# from your website's contents).  Search does not include
# providing AI-generated search summaries.
# ai-input: inputting content into one or more AI models
# (e.g., retrieval augmented generation, grounding, or other
# real-time taking of content for generative AI search
# answers).
# ai-train: training or fine-tuning AI models.

# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS
# RESERVATIONS OF RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN
# UNION DIRECTIVE 2019/790 ON COPYRIGHT AND RELATED RIGHTS
# IN THE DIGITAL SINGLE MARKET.
`;

// ai-input=yes is deliberate: the docs, llms.txt, and agents.md corpora exist
// so an agent can read them at inference time and drive the product. ai-train=no
// reserves the training right we get nothing back for.
const CONTENT_SIGNAL = "Content-Signal: search=yes, ai-input=yes, ai-train=no";

function robotsTxt(origin: string): string {
  return `${CONTENT_SIGNALS_PREAMBLE}
User-agent: *
${CONTENT_SIGNAL}
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
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

// Hand-maintained content-revision date for the sitemap (same pattern as the
// security.txt Expires literal). A per-request `new Date()` would stamp every
// entry "today" on every crawl, falsely signalling the pages just changed; a
// build timestamp would need plumbing this LOW-value field does not justify.
// Bump this (YYYY-MM-DD) when the marketing/docs content is meaningfully
// revised so crawlers know to refetch.
const SITEMAP_LASTMOD = "2026-06-16";

function sitemapXml(origin: string, billingEnabled: boolean): string {
  const docsPages = docsPagesForBilling(billingEnabled);
  const urls = [
    "/",
    "/about",
    "/how-it-works",
    ...(billingEnabled ? ["/pricing"] : []),
    "/docs",
    "/docs.md",
    ...docsPages.flatMap((page) => [docsHtmlPath(page), docsMarkdownPath(page)]),
    "/terms",
    "/privacy",
    "/llms.txt",
    "/llms-full.txt",
    "/agents.md",
  ];
  const entries = urls
    .map((path) => `  <url><loc>${origin}${path}</loc><lastmod>${SITEMAP_LASTMOD}</lastmod></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
