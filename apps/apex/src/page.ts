import {
  FEATURES,
  type Feature,
  FOOTER,
  type FooterColumn,
  HERO,
  META_DESCRIPTION,
  SIGN_IN_URL,
  TITLE,
  TRANSCRIPT,
  type TranscriptLine,
  WORDMARK,
} from "./copy.js";
import { STYLES } from "./styles.js";

export function renderHomePage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(TITLE)}</title>
    <meta name="description" content="${esc(META_DESCRIPTION)}">
    <meta name="color-scheme" content="light dark">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="preload" href="/fonts/HankenGrotesk-Variable.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/JetBrainsMono-Regular.woff2" as="font" type="font/woff2" crossorigin>
    <meta property="og:type" content="website">
    <meta property="og:title" content="agent-paste.sh">
    <meta property="og:description" content="${esc(META_DESCRIPTION)}">
    <meta property="og:url" content="https://agent-paste.sh">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="agent-paste.sh">
    <meta name="twitter:description" content="${esc(META_DESCRIPTION)}">
    <link rel="canonical" href="https://agent-paste.sh/">
    <link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
    <link rel="alternate" type="text/markdown" href="/agents.md" title="agents.md">
    <style>${STYLES}</style>
  </head>
  <body>
    <div class="page">
      <header class="page-head">
        ${renderWordmark()}
        <nav class="head-nav">
          <a class="head-link" href="${esc(HERO.secondary.href)}">agents.md</a>
          <a class="button button-ghost button-sm" href="${esc(SIGN_IN_URL)}">Sign in</a>
        </nav>
      </header>

      <main class="content">
        <section class="hero">
          <p class="eyebrow mono">${esc(HERO.eyebrow)}</p>
          <h1 class="hero-headline">${esc(HERO.headline)}<span class="hero-stop">.</span></h1>
          <p class="hero-lead">${esc(HERO.lead)}</p>
          <div class="hero-actions">
            <a class="button button-primary button-lg" href="${esc(HERO.primary.href)}">${esc(HERO.primary.label)}</a>
            <a class="button button-ghost button-lg" href="${esc(HERO.secondary.href)}">${esc(HERO.secondary.label)}</a>
          </div>
          <pre class="transcript mono" aria-label="Example agent-paste session">${renderTranscript(TRANSCRIPT)}</pre>
        </section>

        <section class="features" aria-label="What agent-paste gives you">
          ${FEATURES.map(renderFeature).join("\n          ")}
        </section>
      </main>

      <footer class="page-foot">
        <div class="foot-cols">
          ${FOOTER.map(renderFooterColumn).join("\n          ")}
        </div>
        <div class="foot-base">
          ${renderWordmark("wordmark-sm")}
          <span class="foot-copy mono">© ${new Date().getFullYear().toString()}</span>
        </div>
      </footer>
    </div>

    <script>
${INLINE_SCRIPT}
    </script>
  </body>
</html>
`;
}

function renderWordmark(extraClass = ""): string {
  const cls = extraClass ? `wordmark ${extraClass}` : "wordmark";
  return `<a class="${cls}" href="/" aria-label="${esc(WORDMARK.base)}${esc(WORDMARK.tld)}">agent<span class="wordmark-hyphen" aria-hidden="true">-</span>paste<span class="wordmark-tld">${esc(WORDMARK.tld)}</span></a>`;
}

function renderFeature(feature: Feature): string {
  return `<article class="feature"><h2 class="feature-title">${esc(feature.title)}</h2><p class="feature-body">${renderProse(feature.body)}</p></article>`;
}

// Escapes first, then turns `backtick` spans into inline <code>. Because the
// span contents are already escaped, the wrapped markup is injection-safe.
function renderProse(text: string): string {
  return esc(text).replace(/`([^`]+)`/g, '<code class="code">$1</code>');
}

function renderFooterColumn(column: FooterColumn): string {
  const links = column.links
    .map((link) => `<li><a class="foot-link" href="${esc(link.href)}">${esc(link.label)}</a></li>`)
    .join("");
  return `<div class="foot-col"><p class="foot-heading mono">${esc(column.heading)}</p><ul class="foot-list">${links}</ul></div>`;
}

function renderTranscript(lines: TranscriptLine[]): string {
  return lines
    .map((line) => {
      if (line.kind === "prompt") {
        return `<span class="t-line"><span class="t-prompt" aria-hidden="true">$</span> <span
        class="t-cmd t-copy"
        role="button"
        tabindex="0"
        data-clipboard="${esc(line.text)}"
        title="Copy command"
        aria-label="${esc(line.text)}, click to copy"
      >${esc(line.text)}</span></span>`;
      }
      if (line.kind === "comment") {
        return `<span class="t-line t-comment"># ${esc(line.text)}</span>`;
      }
      if (line.kind === "success") {
        return `<span class="t-line t-success"><span class="t-check" aria-hidden="true">✓</span> ${esc(line.text)}</span>`;
      }
      if (line.kind === "output") {
        return `<span class="t-line t-output">${esc(line.text)}</span>`;
      }
      const url = `${line.origin}${line.id}`;
      return `<span class="t-line t-result"><span class="t-arrow" aria-hidden="true">→</span> <span
        class="id t-copy"
        role="button"
        tabindex="0"
        data-clipboard="${esc(url)}"
        title="Copy artifact URL"
        aria-label="${esc(url)}, click to copy"
      ><span class="t-origin">${esc(line.origin)}</span><span class="t-id">${esc(line.id)}</span></span></span>`;
    })
    .join("\n");
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const INLINE_SCRIPT = `(() => {
  const FLASH_MS = 700;
  const supportsClipboard = !!(navigator.clipboard && navigator.clipboard.writeText);
  const elements = document.querySelectorAll("[data-clipboard]");
  elements.forEach((el) => {
    const fire = async () => {
      const text = el.getAttribute("data-clipboard");
      if (!text) return;
      try {
        if (supportsClipboard) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        el.setAttribute("data-copied", "true");
        setTimeout(() => el.removeAttribute("data-copied"), FLASH_MS);
      } catch (err) {
        console.error("clipboard write failed", err);
      }
    };
    el.addEventListener("click", fire);
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fire();
      }
    });
  });
})();`;
