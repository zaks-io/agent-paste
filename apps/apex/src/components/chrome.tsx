import { BRAND_MARK } from "@agent-paste/brand";
import { raw } from "hono/html";
import type { Child, FC } from "hono/jsx";
import { FOOTER, type FooterColumn, SIGN_IN_URL, WORDMARK } from "../copy.js";
import { STYLES } from "../styles.js";

const APEX_ORIGIN = "https://agent-paste.sh";

export type PageMeta = {
  title: string;
  description: string;
  canonicalPath: string;
};

function canonicalUrl(path: string): string {
  return `${APEX_ORIGIN}${path}`;
}

export const Wordmark: FC<{ small?: boolean }> = ({ small }) => (
  <span class={small ? "wordmark wordmark-sm" : "wordmark"}>
    agent
    <span class="wordmark-hyphen" aria-hidden="true">
      -
    </span>
    paste<span class="wordmark-tld">{WORDMARK.tld}</span>
  </span>
);

export const Header: FC = () => (
  <header class="page-head">
    <a class="brand" href="/" aria-label={`${WORDMARK.base}${WORDMARK.tld}`}>
      <img class="brand-mark" src={`/${BRAND_MARK}`} width="22" height="22" alt="" aria-hidden="true" />
      <Wordmark />
    </a>
    <nav class="head-nav">
      <a class="head-link" href="/about">
        About
      </a>
      <a class="head-link" href="/docs">
        Docs
      </a>
      <a class="button button-ghost button-sm" href={SIGN_IN_URL}>
        Sign in
      </a>
    </nav>
  </header>
);

export const Footer: FC = () => (
  <footer class="page-foot">
    <div class="foot-cols">
      {FOOTER.map((column) => (
        <FooterCol column={column} />
      ))}
    </div>
    <div class="foot-base">
      <img class="brand-mark" src={`/${BRAND_MARK}`} width="16" height="16" alt="" aria-hidden="true" />
      <a class="brand" href="/" aria-label={`${WORDMARK.base}${WORDMARK.tld}`}>
        <Wordmark small />
      </a>
      <span class="foot-copy mono">© {new Date().getFullYear().toString()}</span>
    </div>
  </footer>
);

const FooterCol: FC<{ column: FooterColumn }> = ({ column }) => (
  <div class="foot-col">
    <p class="foot-heading mono">{column.heading}</p>
    <ul class="foot-list">
      {column.links.map((link) => (
        <li>
          <a class="foot-link" href={link.href}>
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  </div>
);

type ShellProps = {
  meta: PageMeta;
  nonce: string;
  analyticsToken?: string | undefined;
  inlineScript?: string;
  children?: Child;
};

const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

// Cloudflare Web Analytics beacon. A plain nonce'd <script src> works here (apex
// is server-rendered hono/jsx, not React, so nothing strips the nonce); the
// dashboard's script-src 'strict-dynamic' trusts it via the nonce.
const AnalyticsBeacon: FC<{ nonce: string; token?: string | undefined }> = ({ nonce, token }) => {
  const trimmed = token?.trim();
  if (!trimmed) {
    return null;
  }
  return <script nonce={nonce} defer src={BEACON_SRC} data-cf-beacon={JSON.stringify({ token: trimmed })} />;
};

export const Shell: FC<ShellProps> = ({ meta, nonce, analyticsToken, inlineScript, children }) => {
  const canonical = canonicalUrl(meta.canonicalPath);
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{meta.title}</title>
        <meta name="description" content={meta.description} />
        <meta name="color-scheme" content="light dark" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link
          rel="preload"
          href="/fonts/BricolageGrotesque-Variable.woff2"
          as="font"
          type="font/woff2"
          crossorigin=""
        />
        <link rel="preload" href="/fonts/IBMPlexMono-Regular.woff2" as="font" type="font/woff2" crossorigin="" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.description} />
        <meta property="og:url" content={canonical} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={meta.title} />
        <meta name="twitter:description" content={meta.description} />
        <link rel="canonical" href={canonical} />
        <link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt" />
        <link rel="alternate" type="text/plain" href="/llms-full.txt" title="llms-full.txt" />
        <link rel="alternate" type="text/markdown" href="/agents.md" title="agents.md" />
        <link rel="alternate" type="text/markdown" href="/docs.md" title="docs.md" />
        <style nonce={nonce}>{raw(STYLES)}</style>
        <AnalyticsBeacon nonce={nonce} token={analyticsToken} />
      </head>
      <body>
        <div class="page">
          <Header />
          {children}
          <Footer />
        </div>
        {inlineScript ? <script nonce={nonce}>{raw(inlineScript)}</script> : null}
      </body>
    </html>
  );
};

/**
 * Render a page document to a full HTML string. JSX auto-escapes text and
 * attributes; the leading doctype is prepended (hono/jsx does not emit it).
 */
export function renderDocument(node: ReturnType<FC>): string {
  return `<!doctype html>\n${String(node)}`;
}

/**
 * Prose with `backtick` spans turned into inline <code>. The text is escaped
 * first, then the code spans are wrapped, so the resulting markup is injection
 * safe and returned via raw() for JSX embedding.
 */
export function Prose({ text }: { text: string }): ReturnType<FC> {
  return raw(escapeProse(text));
}

function escapeProse(text: string): string {
  return escapeHtml(text).replace(/`([^`]+)`/g, '<code class="code">$1</code>');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
