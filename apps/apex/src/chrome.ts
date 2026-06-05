import { FOOTER, type FooterColumn, META_DESCRIPTION, SIGN_IN_URL, TITLE, WORDMARK } from "./copy.js";
import { STYLES } from "./styles.js";

const APEX_ORIGIN = "https://agent-paste.sh";

type PageMeta = {
  title: string;
  description: string;
  canonicalPath: string;
};

type ShellOptions = {
  meta: PageMeta;
  main: string;
  inlineScript?: string;
};

export function renderShell({ meta, main, inlineScript }: ShellOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(meta.title)}</title>
    <meta name="description" content="${esc(meta.description)}">
    <meta name="color-scheme" content="light dark">
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="shortcut icon" href="/favicon.ico">
    <link rel="preload" href="/fonts/HankenGrotesk-Variable.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/JetBrainsMono-Regular.woff2" as="font" type="font/woff2" crossorigin>
    <meta property="og:type" content="website">
    <meta property="og:title" content="${esc(meta.title)}">
    <meta property="og:description" content="${esc(meta.description)}">
    <meta property="og:url" content="${esc(canonicalUrl(meta.canonicalPath))}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(meta.title)}">
    <meta name="twitter:description" content="${esc(meta.description)}">
    <link rel="canonical" href="${esc(canonicalUrl(meta.canonicalPath))}">
    <link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
    <link rel="alternate" type="text/markdown" href="/agents.md" title="agents.md">
    <style>${STYLES}</style>
  </head>
  <body>
    <div class="page">
      ${renderHeader()}
      ${main}
      ${renderFooter()}
    </div>
${inlineScript ? `\n    <script>\n${inlineScript}\n    </script>` : ""}
  </body>
</html>
`;
}

function canonicalUrl(path: string): string {
  return `${APEX_ORIGIN}${path}`;
}

function renderHeader(): string {
  return `<header class="page-head">
        ${renderWordmark()}
        <nav class="head-nav">
          <a class="head-link" href="/about">About</a>
          <a class="head-link" href="/agents.md">agents.md</a>
          <a class="button button-ghost button-sm" href="${esc(SIGN_IN_URL)}">Sign in</a>
        </nav>
      </header>`;
}

function renderFooter(): string {
  return `<footer class="page-foot">
        <div class="foot-cols">
          ${FOOTER.map(renderFooterColumn).join("\n          ")}
        </div>
        <div class="foot-base">
          ${renderWordmark("wordmark-sm")}
          <span class="foot-copy mono">© ${new Date().getFullYear().toString()}</span>
        </div>
      </footer>`;
}

function renderWordmark(extraClass = ""): string {
  const cls = extraClass ? `wordmark ${extraClass}` : "wordmark";
  return `<a class="${cls}" href="/" aria-label="${esc(WORDMARK.base)}${esc(WORDMARK.tld)}">agent<span class="wordmark-hyphen" aria-hidden="true">-</span>paste<span class="wordmark-tld">${esc(WORDMARK.tld)}</span></a>`;
}

function renderFooterColumn(column: FooterColumn): string {
  const links = column.links
    .map((link) => `<li><a class="foot-link" href="${esc(link.href)}">${esc(link.label)}</a></li>`)
    .join("");
  return `<div class="foot-col"><p class="foot-heading mono">${esc(column.heading)}</p><ul class="foot-list">${links}</ul></div>`;
}

// Escapes first, then turns `backtick` spans into inline <code>. Because the
// span contents are already escaped, the wrapped markup is injection-safe.
export function renderProse(text: string): string {
  return esc(text).replace(/`([^`]+)`/g, '<code class="code">$1</code>');
}

export function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const HOME_META = {
  title: TITLE,
  description: META_DESCRIPTION,
  canonicalPath: "/",
} satisfies PageMeta;
