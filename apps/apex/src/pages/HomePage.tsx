import { Prose } from "@agent-paste/ui";
import type { ReactNode } from "react";
import { TranscriptDemo } from "../components/TranscriptDemo";
import { FEATURES, type Feature, HERO, SIGN_IN_URL } from "../copy";

// The result gesture echoes the brand mark: a caret pointing along a wire into a
// node (the publish/hand-off motif). The wire is the box-drawing glyph U+2500,
// deliberately NOT U+2014 (the em dash): keep it that way so the no-em-dash rule
// and the apex banned-token test hold. The node is a separate span so it can take
// the accent color. index.test.ts pins the exact rendered string; if a formatter
// or an agent rewrites either glyph, that test fails.
const GESTURE_WIRE = ">─";
const GESTURE_NODE = "●";

// The one ID the publish command resolves to. The CLI prints this exact string;
// the resolve rows show it landing as a human URL. index.test.ts pins the
// copy-to-clipboard payload (origin + id).
const ARTIFACT_ORIGIN = "https://agent-paste.sh/";
const ARTIFACT_ID = "art_01HZ8K2X9NPQR3VW7TYBE5MCDF";

const LOGIN_CMD = "npx @zaks-io/agent-paste login";
const PUBLISH_CMD = "npx @zaks-io/agent-paste publish ./report";
const INSTALL_CMD = "curl -fsSL https://agent-paste.sh/install.sh | sh";

// The hero CTA is a bespoke interaction (brightness-up on hover, press nudge on
// active, a trailing arrow that slides on `group` hover) distinct from the shared
// <Button>/<ButtonAnchor> look — so it stays local, but its markup is one
// component used at both hero call sites rather than two copies.
const HERO_CTA =
  "group inline-flex items-center gap-2 font-ui font-semibold text-base " +
  "text-accent-foreground bg-accent border border-accent " +
  "rounded-xs px-6 py-3 cursor-pointer " +
  "transition-[filter,transform] duration-200 ease-out " +
  "hover:brightness-[1.08] active:translate-y-px";

function HeroCta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={HERO_CTA} href={href}>
      {children}
      <span className="transition-transform duration-[220ms] ease-out group-hover:translate-x-[3px]" aria-hidden="true">
        →
      </span>
    </a>
  );
}

// A mono command box: accent prompt, the command, and a Copy button that flips to
// the accent on success (data-copied is set by the shared clipboard script bound
// to [data-clipboard]).
function CommandBox({ cmd }: { cmd: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border border-rule-strong rounded-sm bg-surface px-4 py-4 font-mono text-base [font-feature-settings:'zero']">
      <code className="font-mono text-foreground whitespace-nowrap overflow-x-auto flex-1 min-w-0">
        <span className="text-accent select-none flex-none" aria-hidden="true">
          ${" "}
        </span>
        {cmd}
      </code>
      <button
        type="button"
        className="flex-none font-mono text-mono-sm tracking-wider uppercase text-subtle bg-transparent border border-rule rounded-xs px-2 py-1 cursor-pointer transition-[color,border-color] duration-[180ms] ease-out hover:text-foreground hover:border-rule-strong data-[copied=true]:text-accent data-[copied=true]:border-accent"
        data-clipboard={cmd}
        aria-label={`Copy: ${cmd}`}
      >
        Copy
      </button>
    </div>
  );
}

// Left pane: the sticky hero. Eyebrow, the display headline with the one accent
// word, the lead, and the CTA row.
function HeroPane() {
  return (
    <section className="flex flex-col items-start py-[clamp(40px,6vh,72px)] pb-12 border-b border-rule min-w-0 min-[900px]:sticky min-[900px]:top-[var(--head-h)] min-[900px]:self-start min-[900px]:min-h-[calc(100vh-var(--head-h))] min-[900px]:[padding:var(--pane-pad-y)_var(--pane-gutter)_64px_0] min-[900px]:border-b-0 min-[900px]:border-r min-[900px]:border-rule min-[900px]:justify-center">
      <p className="reveal d1 inline-flex items-center gap-2 font-mono text-mono-sm tracking-eyebrow uppercase text-subtle mb-8">
        <span className="dot w-[6px] h-[6px] rounded-full bg-accent flex-none" aria-hidden="true" />
        {HERO.eyebrow}
      </p>
      <h1 className="reveal d2 font-display font-extrabold text-display-lg leading-tight tracking-tightest [font-feature-settings:'ss01'] text-foreground mb-8 text-balance min-[900px]:text-display-md min-[900px]:max-w-[12ch]">
        Your <span className="text-accent">agent</span> built it. Open it anywhere.
      </h1>
      <p className="reveal d3 text-lg leading-relaxed text-muted mb-8 max-w-[52ch] min-[900px]:text-lg min-[900px]:max-w-[38ch]">
        {HERO.lead}
      </p>
      <div className="reveal d4 flex items-center gap-6 flex-wrap">
        <HeroCta href={SIGN_IN_URL}>{HERO.primary.label}</HeroCta>
        <a
          className="font-ui text-base text-muted py-1 transition-colors duration-200 ease-out hover:text-foreground"
          href="/docs"
        >
          Read the docs
        </a>
      </div>
    </section>
  );
}

// Right pane: the reading column of hairline-ruled blocks.
function DetailPane() {
  return (
    <section className="pt-10 pb-2 min-w-0 min-[900px]:[padding:var(--pane-pad-y)_0_64px_var(--pane-gutter)]">
      <div className="reveal d3 py-[clamp(38px,5vh,56px)] pt-0">
        <p className="font-display font-medium text-display-sm leading-snug tracking-tighter text-foreground max-w-[22ch]">
          A URL for humans. A <span className="text-accent">manifest</span> for agents.
        </p>
      </div>

      <DemoBlock />
      <CommandBlock />
      <ProofBlock />
      <ClosingBlock />
    </section>
  );
}

// A hairline-ruled reading block. The first block has no top padding; subsequent
// blocks get a top rule. scroll-margin keeps the nav anchor clear of the header.
const BLOCK = "py-[clamp(38px,5vh,56px)] [scroll-margin-top:calc(var(--head-h)+24px)] border-t border-rule";
const MARKER = "font-mono text-mono-sm tracking-eyebrow uppercase text-subtle mb-6";

// The lead set-piece: a flat transcript shell showing an agent build something
// and the one command that turns it into a shareable link. This is the section
// the home is built to draw the eye to.
function DemoBlock() {
  return (
    <div className={`reveal d3 ${BLOCK}`} id="demo">
      <div className={MARKER}>
        <span className="text-accent">01</span> / See it happen
      </div>
      <p className="text-base leading-relaxed text-muted mb-5 max-w-[46ch]">
        Your agent renders a folder, in whatever tool you already use. One command publishes it and hands back a link a
        person can open and another agent can read.
      </p>
      <TranscriptDemo />
    </div>
  );
}

function CommandBlock() {
  return (
    <div className={`reveal d4 ${BLOCK}`} id="how">
      <div className={MARKER}>
        <span className="text-accent">02</span> / The command
      </div>
      <p className="text-base leading-relaxed text-muted mb-5 max-w-[46ch]">
        Sign in once over browser OAuth, then publish to hand off what your agent made. The same ID resolves to a page a
        person opens and a manifest another agent reads.
      </p>
      <CommandBox cmd={LOGIN_CMD} />
      <p className="mt-4 text-mono leading-normal text-subtle">
        Browser OAuth provisions a scoped key on your machine. No key to copy or paste.
      </p>
      <CommandBox cmd={PUBLISH_CMD} />

      <div className="mt-6 grid gap-0">
        <div className="grid grid-cols-[72px_1fr] gap-4 items-baseline py-4 border-t border-rule first:border-t-0 first:pt-0">
          <div className="font-mono text-mono-sm tracking-eyebrow uppercase text-subtle">Result</div>
          <div>
            <button
              type="button"
              className="inline-block text-left bg-transparent border-0 px-1 py-1 -mx-1 -my-1 rounded-xs font-mono text-base leading-normal text-muted break-all [font-feature-settings:'zero'] [cursor:copy] transition-[background] duration-[140ms] ease-out hover:bg-accent-tint data-[copied=true]:bg-accent/22"
              data-clipboard={`${ARTIFACT_ORIGIN}${ARTIFACT_ID}`}
              aria-label={`Copy artifact URL: ${ARTIFACT_ORIGIN}${ARTIFACT_ID}`}
            >
              <span className="t-gesture" aria-hidden="true">
                {GESTURE_WIRE}
                <span className="t-gesture-node">{GESTURE_NODE}</span>
              </span>
              {ARTIFACT_ORIGIN}
              <span className="text-accent">{ARTIFACT_ID}</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-[72px_1fr] gap-4 items-baseline py-4 border-t border-rule">
          <div className="font-mono text-mono-sm tracking-eyebrow uppercase text-subtle">Human</div>
          <div>
            <span className="font-mono text-base leading-normal text-muted break-all [font-feature-settings:'zero']">
              opens the page in a browser
            </span>
          </div>
        </div>
        <div className="grid grid-cols-[72px_1fr] gap-4 items-baseline py-4 border-t border-rule">
          <div className="font-mono text-mono-sm tracking-eyebrow uppercase text-subtle">Agent</div>
          <div>
            <span className="font-mono text-base leading-normal text-muted break-all [font-feature-settings:'zero']">
              reads the manifest.json
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProofBlock() {
  return (
    <div className={`reveal d5 ${BLOCK}`} id="features">
      <div className={MARKER}>
        <span className="text-accent">03</span> / Why it holds up
      </div>
      <ol className="list-none m-0 p-0">
        {FEATURES.map((feature, index) => (
          <ProofItem key={feature.title} feature={feature} index={index + 1} />
        ))}
      </ol>
    </div>
  );
}

function ProofItem({ feature, index }: { feature: Feature; index: number }) {
  return (
    <li className="grid grid-cols-[48px_1fr] gap-5 py-6 items-start border-t border-rule first:border-t-0 first:pt-1">
      <span className="font-mono text-sm text-accent pt-1 [font-feature-settings:'zero']">
        {index.toString().padStart(2, "0")}
      </span>
      <div>
        <p className="font-ui font-semibold text-lg tracking-tight leading-snug text-foreground mb-1">
          {feature.title}
        </p>
        <p className="text-base leading-relaxed text-muted m-0 max-w-[56ch] [&_.code]:font-mono [&_.code]:text-[0.9em] [&_.code]:text-foreground [&_.code]:bg-surface-3 [&_.code]:px-1 [&_.code]:py-px [&_.code]:rounded-sm [&_.code]:[font-feature-settings:'zero']">
          <Prose text={feature.body} />
        </p>
      </div>
    </li>
  );
}

function ClosingBlock() {
  return (
    <div className={`reveal d6 ${BLOCK}`} id="docs">
      <div className={MARKER}>
        <span className="text-accent">04</span> / Get started
      </div>
      <CommandBox cmd={INSTALL_CMD} />
      <p className="text-base leading-relaxed text-subtle mt-4 mb-8">
        <b className="text-foreground font-semibold">Free to start.</b> Add{" "}
        <code className="font-mono text-[0.9em] text-foreground bg-surface-3 px-1 py-px rounded-sm [font-feature-settings:'zero']">
          --ephemeral
        </code>{" "}
        to publish with no account at all.
      </p>
      <HeroCta href={SIGN_IN_URL}>Get started free</HeroCta>
    </div>
  );
}

export function HomePage() {
  return (
    <main>
      <div className="max-w-[1280px] mx-auto px-[clamp(20px,4vw,72px)]">
        <div className="grid grid-cols-1 min-[900px]:grid-cols-[40%_60%] min-[900px]:items-start">
          <HeroPane />
          <DetailPane />
        </div>
      </div>
    </main>
  );
}
