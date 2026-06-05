import { ABOUT, ABOUT_SECTIONS, type AboutSection } from "./about.js";
import { esc, HOME_META, renderProse, renderShell } from "./chrome.js";
import { FEATURES, type Feature, HERO, TRANSCRIPT, type TranscriptLine } from "./copy.js";

const ABOUT_TITLE = "About agent-paste.sh: where agents publish";
const ABOUT_DESCRIPTION =
  "Why agent-paste exists, the wedge it fills, the boundaries it keeps, and an honest account of how it is built and run. Pre-launch, solo, transient by default.";

export function renderHomePage(): string {
  return renderShell({
    meta: HOME_META,
    main: `<main class="content">
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
      </main>`,
    inlineScript: INLINE_SCRIPT,
  });
}

export function renderAboutPage(): string {
  return renderShell({
    meta: {
      title: ABOUT_TITLE,
      description: ABOUT_DESCRIPTION,
      canonicalPath: "/about",
    },
    main: `<main class="content">
        <section class="hero">
          <p class="eyebrow mono">${esc(ABOUT.eyebrow)}</p>
          <h1 class="hero-headline">${esc(ABOUT.headline)}<span class="hero-stop">.</span></h1>
          <p class="hero-lead">${esc(ABOUT.lead)}</p>
        </section>

        <section class="prose" aria-label="About agent-paste">
          ${ABOUT_SECTIONS.map(renderAboutSection).join("\n          ")}
        </section>
      </main>`,
  });
}

function renderFeature(feature: Feature): string {
  return `<article class="feature"><h2 class="feature-title">${esc(feature.title)}</h2><p class="feature-body">${renderProse(feature.body)}</p></article>`;
}

function renderAboutSection(section: AboutSection): string {
  const paragraphs = section.body.map((paragraph) => `<p class="prose-body">${renderProse(paragraph)}</p>`).join("");
  return `<article class="prose-block"><h2 class="prose-title">${esc(section.title)}</h2>${paragraphs}</article>`;
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
