import { BRAND_MARK } from "@agent-paste/brand";
import { raw } from "hono/html";
import type { Child, FC } from "hono/jsx";
import { FOOTER, type FooterColumn, INSTALL_LINKS, SIGN_IN_URL, WORDMARK } from "../copy.js";
import { HOME_STYLES, STYLES } from "../styles.js";

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

// The single marketing header for every apex page: brand left, nav center,
// "Get started free" right, sticky. The "How it works"/"Features" links target
// the home sections by absolute anchor (/#how, /#features) so they resolve from
// docs/about/legal too, not just the home page.
export const Header: FC<{ billingEnabled: boolean }> = ({ billingEnabled }) => (
  <header class="topbar" id="topbar">
    <div class="wrap topbar-inner">
      <a class="brand" href="/" aria-label={`${WORDMARK.base}${WORDMARK.tld}`}>
        <img class="brand-mark" src={`/${BRAND_MARK}`} width="24" height="24" alt="" aria-hidden="true" />
        <Wordmark />
      </a>
      <nav class="head-center">
        <a class="head-link" href="/#how">
          How it works
        </a>
        <a class="head-link" href="/#features">
          Features
        </a>
        <a class="head-link" href="/docs">
          Docs
        </a>
        {billingEnabled ? (
          <a class="head-link" href="/pricing">
            Pricing
          </a>
        ) : null}
        <a class="head-link" href="/about">
          About
        </a>
      </nav>
      <div class="head-end">
        <a class="button button-primary button-sm" href={SIGN_IN_URL}>
          Get started free
        </a>
      </div>
    </div>
  </header>
);

function footerColumns(billingEnabled: boolean): FooterColumn[] {
  if (!billingEnabled) {
    return FOOTER;
  }
  return FOOTER.map((column) =>
    column.heading === "Product"
      ? {
          ...column,
          links: [{ label: "Pricing", href: "/pricing" }, ...column.links],
        }
      : column,
  );
}

export const Footer: FC<{ billingEnabled: boolean }> = ({ billingEnabled }) => (
  <footer class="home-foot">
    <div class="wrap">
      <div class="home-foot-grid">
        <div class="home-foot-brand">
          <a class="brand" href="/" aria-label={`${WORDMARK.base}${WORDMARK.tld}`}>
            <img class="brand-mark" src={`/${BRAND_MARK}`} width="22" height="22" alt="" aria-hidden="true" />
            <Wordmark small />
          </a>
          <p class="home-foot-tag">
            The neutral hand-off layer for what your agent makes. Publish once, open it anywhere.
          </p>
        </div>
        {footerColumns(billingEnabled).map((column) => (
          <FooterCol column={column} />
        ))}
      </div>
      <div class="home-foot-base">
        <span class="home-foot-tagline">where agents publish</span>
        <span class="home-foot-install">
          <span class="home-foot-install-label">install</span>
          {INSTALL_LINKS.map((link) => (
            <a class="home-foot-install-link" href={link.href}>
              {link.label}
            </a>
          ))}
        </span>
        <span class="home-foot-copy">© {new Date().getFullYear().toString()} zaks-io</span>
      </div>
    </div>
  </footer>
);

const FooterCol: FC<{ column: FooterColumn }> = ({ column }) => (
  <div>
    <p class="home-foot-heading">{column.heading}</p>
    <ul class="home-foot-list">
      {column.links.map((link) => (
        <li>
          <a class="home-foot-link foot-link" href={link.href}>
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
  billingEnabled: boolean;
  inlineScript?: string;
  /**
   * Full-bleed content mode for the marketing home page: its sections set their
   * own width. Every page shares the sticky marketing Header and Footer; on
   * non-bleed pages (docs/about/legal) the content is wrapped in a constrained
   * `.page-body` container so prose stays at a readable measure.
   */
  bleed?: boolean;
  children?: Child;
};

// Sticky-state toggle for the shared topbar. Runs on every page (home layers its
// own reveal/copy script on top via inlineScript). Idempotent: home's richer
// script no longer binds the scroll handler, so there is no double-binding.
const HEADER_SCRIPT = `(() => {
  const bar = document.getElementById("topbar");
  if (!bar) return;
  const onScroll = () => bar.setAttribute("data-stuck", String(window.scrollY > 8));
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
})();`;

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

export const Shell: FC<ShellProps> = ({
  meta,
  nonce,
  analyticsToken,
  billingEnabled,
  inlineScript,
  bleed,
  children,
}) => {
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
        <style nonce={nonce}>{raw(HOME_STYLES)}</style>
        <AnalyticsBeacon nonce={nonce} token={analyticsToken} />
      </head>
      <body class="home">
        <Header billingEnabled={billingEnabled} />
        {bleed ? children : <div class="page-body">{children}</div>}
        <Footer billingEnabled={billingEnabled} />
        <script nonce={nonce}>{raw(HEADER_SCRIPT)}</script>
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
