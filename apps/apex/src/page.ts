import { HERO, META_DESCRIPTION, TITLE, TRANSCRIPT, type TranscriptLine, WORDMARK } from "./copy.js";
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
    <main class="page">
      <header class="page-head">
        <a class="wordmark" href="/" aria-label="agent-paste.sh">
          <span class="wordmark-base">${esc(WORDMARK.base)}</span><span class="wordmark-tld">${esc(WORDMARK.tld)}</span>
        </a>
      </header>

      <section class="hero">
        <h1 class="hero-headline">${esc(HERO.headline)}<span class="hero-headline-stop">.</span></h1>
        <p class="hero-lead">${esc(HERO.lead)}</p>

        <pre class="transcript" aria-label="Example agent-paste session">${renderTranscript(TRANSCRIPT)}</pre>

        <a class="button button-primary button-lg" href="${esc(HERO.primary.href)}">${esc(HERO.primary.label)}</a>
      </section>

      <footer class="page-foot mono">
        <a class="foot-link" href="/agents.md">/agents.md</a>
        <span>© ${new Date().getFullYear().toString()}</span>
      </footer>
    </main>

    <script>
${INLINE_SCRIPT}
    </script>
  </body>
</html>
`;
}

function renderTranscript(lines: TranscriptLine[]): string {
  return lines
    .map((line) => {
      if (line.kind === "prompt") {
        return `<span class="t-line"><span class="t-prompt" aria-hidden="true">$</span> <span class="t-cmd">${esc(line.text)}</span></span>`;
      }
      if (line.kind === "comment") {
        return `<span class="t-line t-comment"># ${esc(line.text)}</span>`;
      }
      if (line.kind === "output") {
        return `<span class="t-line t-output">  ${esc(line.text)}</span>`;
      }
      const url = `${line.origin}${line.id}`;
      return `<span class="t-line t-result">  <span
        class="id is-inline"
        role="button"
        tabindex="0"
        data-clipboard="${esc(url)}"
        title="${esc(url)} — click to copy"
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
