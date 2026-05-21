import { FEATURES, FOOTER_COLS, GITHUB_URL, HERO, INSTALL, META_DESCRIPTION, TITLE } from "./copy.js";
import { STYLES } from "./styles.js";

const SAMPLE_ID = INSTALL.sampleId;
const SAMPLE_ID_SHORT = `${SAMPLE_ID.slice(0, 9)}…${SAMPLE_ID.slice(-4)}`;

export function renderHomePage(): string {
  const features = FEATURES.map(
    (feature, index) => `
        <article class="feature">
          <span class="feature-index">${pad(index + 1)} / ${pad(FEATURES.length)}</span>
          <h2 class="feature-h">${esc(feature.heading)}</h2>
          <p class="feature-body">${esc(feature.body)}</p>
        </article>`,
  ).join("");

  const footerCols = FOOTER_COLS.map(
    (col) => `
        <div class="footer-col">
          <h3>${esc(col.heading)}</h3>
          <ul>
            ${col.items.map((item) => `<li><a href="${esc(item.href)}">${esc(item.label)}</a></li>`).join("\n            ")}
          </ul>
        </div>`,
  ).join("");

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
    <meta property="og:title" content="agent-paste">
    <meta property="og:description" content="${esc(META_DESCRIPTION)}">
    <meta property="og:url" content="https://agent-paste.sh">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="agent-paste">
    <meta name="twitter:description" content="${esc(META_DESCRIPTION)}">
    <link rel="canonical" href="https://agent-paste.sh/">
    <link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
    <link rel="alternate" type="text/markdown" href="/agents.md" title="agents.md">
    <style>${STYLES}</style>
  </head>
  <body>
    <header class="bleed">
      <div class="container masthead">
        <a class="wordmark" href="/">agent<span class="wordmark-hyphen">-</span>paste</a>
        <nav class="masthead-nav" aria-label="Primary">
          <a class="masthead-link is-secondary" href="/agents.md">For agents</a>
          <a class="masthead-link is-secondary" href="${esc(GITHUB_URL)}">GitHub</a>
          <a class="button button-primary" href="${esc(HERO.primary.href)}">${esc(HERO.primary.label)}</a>
        </nav>
      </div>
    </header>
    <main>
      <section class="bleed">
        <div class="container hero">
          <div class="hero-content">
            <h1 class="hero-headline">${esc(HERO.headline)}</h1>
            <p class="hero-lead">${esc(HERO.lead)}</p>
            <div class="hero-actions">
              <a class="button button-primary button-lg" href="${esc(HERO.primary.href)}">${esc(HERO.primary.label)}</a>
              <a class="button button-link button-lg" href="${esc(HERO.secondary.href)}">${esc(HERO.secondary.label)} →</a>
            </div>
            <div class="install">
              <pre class="code-block" aria-label="Install command"><span class="prompt" aria-hidden="true">$</span><code>${esc(INSTALL.command)}</code><button class="code-copy" type="button" data-clipboard="${esc(INSTALL.command)}" aria-label="Copy install command">copy</button></pre>
              <p class="install-meta">
                <span>${esc(INSTALL.caption)}</span>
                <span
                  class="id"
                  role="button"
                  tabindex="0"
                  data-clipboard="${esc(SAMPLE_ID)}"
                  title="${esc(SAMPLE_ID)} — click to copy"
                  aria-label="${esc(SAMPLE_ID)}, click to copy"
                >${esc(SAMPLE_ID_SHORT)}</span>
              </p>
            </div>
          </div>
        </div>
      </section>
      <section class="bleed features">
        <div class="container">
          <div class="features-grid">${features}
          </div>
        </div>
      </section>
    </main>
    <footer class="bleed footer">
      <div class="container">
        <div class="footer-grid">${footerCols}
        </div>
        <div class="footer-meta">
          <span>${esc(new Date().getFullYear().toString())} · agent-paste</span>
          <span>built on Cloudflare Workers</span>
        </div>
      </div>
    </footer>
    <script>
${INLINE_SCRIPT}
    </script>
  </body>
</html>
`;
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
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
