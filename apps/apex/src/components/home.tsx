import type { FC } from "hono/jsx";
import { FEATURES, type Feature, HERO, PILLARS, TRANSCRIPT, type TranscriptLine } from "../copy.js";
import { HOME_META } from "../meta.js";
import { Prose, renderDocument, Shell } from "./chrome.js";
import { Gesture } from "./Gesture.js";

const Hero: FC = () => (
  <section class="hero">
    <div class="hero-text">
      <p class="eyebrow mono">{HERO.eyebrow}</p>
      <h1 class="hero-headline">
        {HERO.headline}
        <span class="hero-stop">.</span>
      </h1>
      <p class="hero-lead">{HERO.lead}</p>
      <div class="hero-actions">
        <a class="button button-primary button-lg" href={HERO.primary.href}>
          {HERO.primary.label}
        </a>
        <a class="button button-ghost button-lg" href={HERO.secondary.href}>
          {HERO.secondary.label}
        </a>
      </div>
    </div>
    <Transcript lines={TRANSCRIPT} />
  </section>
);

const Pillars: FC = () => (
  <section class="pillars-section" aria-label="Why agent-paste">
    <ul class="pillars">
      {PILLARS.map((text) => (
        <li class="pillar">
          <Gesture />
          <span class="pillar-title">{text}</span>
        </li>
      ))}
    </ul>
  </section>
);

const Features: FC = () => (
  <section class="features" aria-label="What agent-paste gives you">
    {FEATURES.map((feature) => (
      <FeatureBlock feature={feature} />
    ))}
  </section>
);

const FeatureBlock: FC<{ feature: Feature }> = ({ feature }) => (
  <article class="feature">
    <h2 class="feature-title">{feature.title}</h2>
    <p class="feature-body">
      <Prose text={feature.body} />
    </p>
  </article>
);

const Transcript: FC<{ lines: TranscriptLine[] }> = ({ lines }) => (
  <figure class="transcript-figure" aria-label="Example agent-paste session">
    <pre class="transcript mono">
      {lines.map((line, index) => (
        <>
          <TranscriptLineView line={line} />
          {index < lines.length - 1 ? "\n" : ""}
        </>
      ))}
    </pre>
  </figure>
);

const TranscriptLineView: FC<{ line: TranscriptLine }> = ({ line }) => {
  if (line.kind === "prompt") {
    return (
      <span class="t-line">
        <span class="t-prompt" aria-hidden="true">
          $
        </span>{" "}
        <button
          type="button"
          class="t-cmd t-copy"
          data-clipboard={line.text}
          title="Copy command"
          aria-label={`${line.text}, click to copy`}
        >
          {line.text}
        </button>
      </span>
    );
  }
  if (line.kind === "comment") {
    return <span class="t-line t-comment"># {line.text}</span>;
  }
  if (line.kind === "success") {
    return (
      <span class="t-line t-success">
        <span class="t-check" aria-hidden="true">
          ✓
        </span>{" "}
        {line.text}
      </span>
    );
  }
  if (line.kind === "output") {
    return <span class="t-line t-output">{line.text}</span>;
  }
  const url = `${line.origin}${line.id}`;
  return (
    <span class="t-line t-result">
      <Gesture class="t-gesture" />
      <button
        type="button"
        class="id t-copy"
        data-clipboard={url}
        title="Copy artifact URL"
        aria-label={`${url}, click to copy`}
      >
        <span class="t-origin">{line.origin}</span>
        <span class="t-id">{line.id}</span>
      </button>
    </span>
  );
};

const HomePage: FC<{ nonce: string; analyticsToken?: string | undefined }> = ({ nonce, analyticsToken }) => (
  <Shell meta={HOME_META} nonce={nonce} analyticsToken={analyticsToken} inlineScript={INLINE_SCRIPT}>
    <main class="content">
      <Hero />
      <hr class="motif-rule" />
      <Pillars />
      <hr class="motif-rule" />
      <Features />
    </main>
  </Shell>
);

export function renderHomePage(nonce: string, analyticsToken?: string): string {
  return renderDocument(<HomePage nonce={nonce} analyticsToken={analyticsToken} />);
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
  });
})();`;
