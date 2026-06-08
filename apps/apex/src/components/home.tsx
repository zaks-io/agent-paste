import { BRAND_MARK } from "@agent-paste/brand";
import type { FC } from "hono/jsx";
import { FEATURES, type Feature, HERO, SIGN_IN_URL, TRANSCRIPT, type TranscriptLine } from "../copy.js";
import { HOME_META } from "../meta.js";
import { Prose, renderDocument, Shell } from "./chrome.js";

// The result-line gesture echoes the brand mark: a caret pointing along a wire
// into a node (the publish/hand-off motif). The wire is the box-drawing glyph
// U+2500, deliberately NOT U+2014 (the em dash): keep it that way so the
// no-em-dash rule and the apex banned-token test hold. The node is a separate
// span so it can take the accent color. index.test.ts pins the exact rendered
// string; if the formatter or an agent rewrites either glyph, that test fails.
const GESTURE_WIRE = ">─";
const GESTURE_NODE = "●";

const Hero: FC = () => (
  <section class="home-hero wrap">
    <div class="hero-art reveal d1">
      <img src={`/${BRAND_MARK}`} alt="agent-paste mark: a capture frame around a hand-off gesture" />
    </div>
    <span class="home-eyebrow reveal d1">
      <span class="dot" aria-hidden="true" />
      {HERO.eyebrow}
    </span>
    <h1 class="home-hero-headline reveal d2">
      {HERO.headline}
      <span class="stop">.</span>
    </h1>
    <p class="home-hero-lead reveal d3">{HERO.lead}</p>
    <div class="home-hero-actions reveal d4">
      <a class="button button-primary button-lg" href={SIGN_IN_URL}>
        {HERO.primary.label}
      </a>
      <a class="button-link-lg reveal d4" href="/docs">
        Read the docs
      </a>
    </div>
  </section>
);

const TranscriptSection: FC = () => (
  <section class="transcript-stage wrap">
    <figure class="transcript-shell reveal d2" aria-label="Example agent-paste session">
      <div class="transcript-bar">
        <span class="tl-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span class="tl-title">agent · publish</span>
      </div>
      <pre class="transcript mono">
        {TRANSCRIPT.map((line, index) => (
          <>
            <TranscriptLineView line={line} />
            {index < TRANSCRIPT.length - 1 ? "\n" : ""}
          </>
        ))}
        <span class="t-cursor" aria-hidden="true" />
      </pre>
    </figure>
  </section>
);

const TranscriptLineView: FC<{ line: TranscriptLine }> = ({ line }) => {
  if (line.kind === "prompt") {
    return (
      <span class="t-line t-gutter">
        <span class="t-prompt" aria-hidden="true">
          $
        </span>
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
      <span class="t-line t-gutter t-success">
        <span class="t-check" aria-hidden="true">
          ✓
        </span>
        <span class="t-gutter-body">{line.text}</span>
      </span>
    );
  }
  if (line.kind === "output") {
    return <span class="t-line t-output">{line.text}</span>;
  }
  const url = `${line.origin}${line.id}`;
  return (
    <span class="t-line t-gutter t-result">
      <span class="t-gesture" aria-hidden="true">
        {GESTURE_WIRE}
        <span class="t-gesture-node">{GESTURE_NODE}</span>
      </span>
      <button
        type="button"
        class="t-copy"
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

type UseCase = {
  who: string;
  title: string;
  body: string;
  icon: ReturnType<FC>;
};

// Display copy excerpted from docs/specs/use-cases.md, which owns the canonical
// use-case matrix.
const USE_CASES: UseCase[] = [
  {
    who: "Sharing it",
    title: "Send it to a friend",
    body: "Your agent built a page. One command turns it into a link you can text someone or drop in a chat, with no hosting to stand up.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M22 2 11 13" />
        <path d="M22 2 15 22l-4-9-9-4z" />
      </svg>
    ),
  },
  {
    who: "The builder",
    title: "Publish an asset in seconds",
    body: "Skip spinning up a Vercel project just to share one report. One command, one link, you're done.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M13 2L3 14h7l-1 8 10-12h-7z" />
      </svg>
    ),
  },
  {
    who: "Away from the desk",
    title: "Open it on your phone",
    body: "A remote agent just generated something? Get a link you can open from anywhere, on any device, in one tap.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="6" y="2" width="12" height="20" rx="2.5" />
        <path d="M11 18h2" />
      </svg>
    ),
  },
  {
    who: "Watching it work",
    title: "Updates live as it changes",
    body: "Leave the link open. When the agent revises the work, the page swaps to the new version on its own. No refresh.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 4v5h-5" />
      </svg>
    ),
  },
];

const UseCases: FC = () => (
  <section class="home-section wrap" id="for">
    <div class="section-head reveal">
      <span class="section-kicker">Who it's for</span>
      <h2 class="section-title">When you just need a link, not a deploy</h2>
      <p class="section-sub">
        If you've ever stood up a whole hosting setup to share one thing an agent made, this is for you.
      </p>
    </div>
    <div class="usecases">
      {USE_CASES.map((useCase, index) => (
        <article class={`usecase reveal d${index + 1}`}>
          <span class="usecase-icon">{useCase.icon}</span>
          <span class="usecase-who">{useCase.who}</span>
          <h3 class="usecase-title">{useCase.title}</h3>
          <p class="usecase-body">{useCase.body}</p>
        </article>
      ))}
    </div>
  </section>
);

type HomePillar = { num: string; title: string; body: string };

const HOME_PILLARS: HomePillar[] = [
  {
    num: "01",
    title: "Open it in a browser, hand it to an agent",
    body: "A human opens the link and just sees the work. Another agent reads the same thing as structured data. One hand-off, two readers, no extra wiring.",
  },
  {
    num: "02",
    title: "Escape the walled garden",
    body: "Work made inside one tool usually stays trapped there. agent-paste is the neutral layer in between, so an agent in any tool can pass it to a human or an agent in any other.",
  },
  {
    num: "03",
    title: "Safe to host what you didn't write",
    body: "Agent output is rendered behind hardened isolation, so you can open what an agent built without trusting it with your account or your data.",
  },
  {
    num: "04",
    title: "Yours to pull back anytime",
    body: "Share through a revocable link and cut access whenever you want. A hand-off, not a vault: nothing you publish is stuck out there for good.",
  },
];

const Pillars: FC = () => (
  <section class="home-section wrap" id="how">
    <div class="section-head reveal">
      <span class="section-kicker">Why it works</span>
      <h2 class="section-title">A neutral layer between every agent and every reader</h2>
      <p class="section-sub">No vendor lock-in, no deploy, no repo. Publish from any tool, open it anywhere.</p>
    </div>
    <div class="home-pillars">
      {HOME_PILLARS.map((pillar, index) => (
        <article class={`home-pillar reveal d${index + 1}`}>
          <span class="home-pillar-num">{pillar.num}</span>
          <h3 class="home-pillar-title">{pillar.title}</h3>
          <p class="home-pillar-body">{pillar.body}</p>
        </article>
      ))}
    </div>
  </section>
);

const Diagram: FC = () => (
  <section class="home-section wrap" aria-label="How a published Artifact is picked up">
    <div class="section-head reveal">
      <span class="section-kicker">The shape of it</span>
      <h2 class="section-title">Publish once, picked up anywhere</h2>
    </div>
    <div class="diagram">
      <div class="diagram-id reveal d1">
        <div class="label">Publish once</div>
        <div class="val">agent-paste publish ./report</div>
      </div>
      <div class="diagram-mid reveal d2" aria-hidden="true">
        <svg
          viewBox="0 0 120 64"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M4 32h60" />
          <path d="M64 32c20 0 26-22 48-22" opacity="0.85" />
          <path d="M64 32c20 0 26 22 48 22" opacity="0.85" />
          <circle cx="4" cy="32" r="3.5" fill="currentColor" stroke="none" />
          <circle cx="112" cy="10" r="3.5" fill="currentColor" stroke="none" />
          <circle cx="112" cy="54" r="3.5" fill="currentColor" stroke="none" />
        </svg>
      </div>
      <div class="diagram-out">
        <div class="diagram-card reveal d3">
          <div class="head">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 9h18" />
            </svg>
            A human opens a URL
          </div>
          <div class="desc">just sees the work, in a browser</div>
        </div>
        <div class="diagram-card reveal d4">
          <div class="head">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h2M16 4h2a2 2 0 012 2v12a2 2 0 01-2 2h-2" />
            </svg>
            An agent reads structured data
          </div>
          <div class="desc">picks it up and keeps going</div>
        </div>
      </div>
    </div>
  </section>
);

const FEATURE_ICONS: ReturnType<FC>[] = [
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M3 12h7l-3-3M3 12l4 4M21 12h-7l3 3M21 12l-4-4" />
  </svg>,
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" />
  </svg>,
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M3 12h3M18 12h3M12 3v3M12 18v3" />
  </svg>,
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>,
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M12 3v12M8 11l4 4 4-4M5 21h14" />
  </svg>,
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>,
];

const Features: FC = () => (
  <section class="home-section wrap" id="features">
    <div class="section-head reveal">
      <span class="section-kicker">Everything in one place</span>
      <h2 class="section-title">Built for the hand-off</h2>
      <p class="section-sub">Publish from anywhere, watch it update in place, and keep control of who can see it.</p>
    </div>
    <div class="home-features">
      {FEATURES.map((feature, index) => (
        <FeatureBlock feature={feature} icon={FEATURE_ICONS[index % FEATURE_ICONS.length] ?? null} delay={index + 1} />
      ))}
    </div>
  </section>
);

const FeatureBlock: FC<{
  feature: Feature;
  icon: ReturnType<FC>;
  delay: number;
}> = ({ feature, icon, delay }) => (
  <article class={`home-feature reveal d${delay}`}>
    <span class="home-feature-mark">{icon}</span>
    <h3 class="home-feature-title">{feature.title}</h3>
    <p class="home-feature-body">
      <Prose text={feature.body} />
    </p>
  </article>
);

const ClosingCta: FC = () => (
  <section class="home-cta wrap">
    <div class="cta-card reveal">
      <h2 class="cta-title">
        Try it for free<span class="stop">.</span>
      </h2>
      <p class="cta-sub">
        Publish your first Artifact in one command. No card, no deploy, no repo. Add <code>--ephemeral</code> and you
        don't even need an account.
      </p>
      <div class="cta-actions">
        <a class="button button-accent button-lg" href={SIGN_IN_URL}>
          Get started free
        </a>
        <a class="button button-ghost button-lg" href="/docs">
          Read the docs
        </a>
      </div>
      <button
        type="button"
        class="cta-install"
        data-clipboard="curl -fsSL https://agent-paste.sh/install.sh | sh"
        title="Copy install command"
      >
        <span class="prompt" aria-hidden="true">
          $
        </span>
        <span class="cta-install-cmd">curl -fsSL agent-paste.sh/install.sh | sh</span>
        <span class="copyhint" aria-hidden="true">
          click to copy
        </span>
      </button>
    </div>
  </section>
);

const HomePage: FC<{ nonce: string; analyticsToken?: string | undefined; billingEnabled: boolean }> = ({
  nonce,
  analyticsToken,
  billingEnabled,
}) => (
  <Shell
    meta={HOME_META}
    nonce={nonce}
    analyticsToken={analyticsToken}
    billingEnabled={billingEnabled}
    inlineScript={INLINE_SCRIPT}
    bleed
  >
    <main>
      <Hero />
      <TranscriptSection />
      <UseCases />
      <Pillars />
      <Diagram />
      <Features />
      <ClosingCta />
    </main>
  </Shell>
);

export function renderHomePage(nonce: string, analyticsToken?: string, billingEnabled = false): string {
  return renderDocument(<HomePage nonce={nonce} analyticsToken={analyticsToken} billingEnabled={billingEnabled} />);
}

// Home-only inline scripts: scroll-reveal and click-to-copy. The sticky-header
// toggle is shared across all pages and lives in chrome.tsx's HEADER_SCRIPT.
const INLINE_SCRIPT = `(() => {
  const els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    els.forEach((e) => e.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
  els.forEach((e) => io.observe(e));
  requestAnimationFrame(() => {
    document
      .querySelectorAll(".home-hero .reveal, .transcript-shell.reveal")
      .forEach((e) => e.classList.add("in"));
  });
})();

(() => {
  const FLASH_MS = 700;
  const supportsClipboard = !!(navigator.clipboard && navigator.clipboard.writeText);
  document.querySelectorAll("[data-clipboard]").forEach((el) => {
    el.addEventListener("click", async () => {
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
    });
  });
})();`;
