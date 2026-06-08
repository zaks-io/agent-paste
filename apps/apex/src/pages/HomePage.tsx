import { Prose } from "@agent-paste/ui";
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

// The primary CTA renders as an anchor, so it cannot use the shared <Button>
// (button-only). These utilities reproduce the `.btn-primary` look exactly:
// accent fill, accent-fg text, square xs radius, brightness-up on hover, press
// nudge on active. The trailing arrow slides right on hover via the `group`.
const PRIMARY_CTA =
  "group inline-flex items-center gap-[9px] font-[var(--font-ui)] font-semibold text-[14.5px] " +
  "text-[hsl(var(--accent-fg))] bg-[hsl(var(--accent))] border border-[hsl(var(--accent))] " +
  "rounded-[var(--radius-xs)] px-[22px] py-[12px] cursor-pointer " +
  "transition-[filter,transform] duration-200 ease-[var(--ease-out)] " +
  "hover:brightness-[1.08] active:translate-y-px";

// A mono command box: accent prompt, the command, and a Copy button that flips to
// the accent on success (data-copied is set by the shared clipboard script bound
// to [data-clipboard]).
function CommandBox({ cmd }: { cmd: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border border-[hsl(var(--rule-strong))] rounded-[var(--radius-sm)] bg-[hsl(var(--surface))] px-4 py-[14px] font-[var(--font-mono)] text-[14px] [font-feature-settings:'zero']">
      <code className="font-[var(--font-mono)] text-[hsl(var(--foreground))] whitespace-nowrap overflow-x-auto flex-1 min-w-0">
        <span className="text-[hsl(var(--accent))] select-none flex-none" aria-hidden="true">
          ${" "}
        </span>
        {cmd}
      </code>
      <button
        type="button"
        className="flex-none font-[var(--font-mono)] text-[11px] tracking-[0.08em] uppercase text-[hsl(var(--subtle))] bg-transparent border border-[hsl(var(--rule))] rounded-[var(--radius-xs)] px-[9px] py-[5px] cursor-pointer transition-[color,border-color] duration-[180ms] ease-[var(--ease-out)] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--rule-strong))] data-[copied=true]:text-[hsl(var(--accent))] data-[copied=true]:border-[hsl(var(--accent))]"
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
    <section className="flex flex-col items-start py-[clamp(40px,6vh,72px)] pb-12 border-b border-[hsl(var(--rule))] min-w-0 min-[900px]:sticky min-[900px]:top-[var(--head-h)] min-[900px]:self-start min-[900px]:min-h-[calc(100vh-var(--head-h))] min-[900px]:[padding:var(--pane-pad-y)_var(--pane-gutter)_64px_0] min-[900px]:border-b-0 min-[900px]:border-r min-[900px]:border-[hsl(var(--rule))] min-[900px]:justify-center">
      <p className="reveal d1 inline-flex items-center gap-[9px] font-[var(--font-mono)] text-[11.5px] tracking-[0.16em] uppercase text-[hsl(var(--subtle))] mb-7">
        <span className="dot w-[6px] h-[6px] rounded-full bg-[hsl(var(--accent))] flex-none" aria-hidden="true" />
        {HERO.eyebrow}
      </p>
      <h1 className="reveal d2 font-[var(--font-display)] font-extrabold text-[clamp(42px,7vw,72px)] leading-[1.02] tracking-[-0.035em] [font-feature-settings:'ss01'] text-[hsl(var(--foreground))] mb-7 text-balance min-[900px]:text-[clamp(40px,5vw,66px)] min-[900px]:max-w-[12ch]">
        Your <span className="text-[hsl(var(--accent))]">agent</span> built it. Open it anywhere.
      </h1>
      <p className="reveal d3 text-[clamp(16px,1.7vw,18px)] leading-[1.6] text-[hsl(var(--muted))] mb-9 max-w-[52ch] min-[900px]:text-[clamp(15px,1.15vw,17px)] min-[900px]:max-w-[38ch]">
        {HERO.lead}
      </p>
      <div className="reveal d4 flex items-center gap-[22px] flex-wrap">
        <a className={PRIMARY_CTA} href={SIGN_IN_URL}>
          {HERO.primary.label}
          <span
            className="transition-transform duration-[220ms] ease-[var(--ease-out)] group-hover:translate-x-[3px]"
            aria-hidden="true"
          >
            →
          </span>
        </a>
        <a
          className="font-[var(--font-ui)] text-[14.5px] text-[hsl(var(--muted))] py-1 transition-colors duration-200 ease-[var(--ease-out)] hover:text-[hsl(var(--foreground))]"
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
        <p className="font-[var(--font-display)] font-medium text-[clamp(24px,2.6vw,34px)] leading-[1.18] tracking-[-0.02em] text-[hsl(var(--foreground))] max-w-[22ch]">
          A URL for humans. A <span className="text-[hsl(var(--accent))]">manifest</span> for agents.
        </p>
      </div>

      <CommandBlock />
      <ProofBlock />
      <ClosingBlock />
    </section>
  );
}

// A hairline-ruled reading block. The first block has no top padding; subsequent
// blocks get a top rule. scroll-margin keeps the nav anchor clear of the header.
const BLOCK =
  "py-[clamp(38px,5vh,56px)] [scroll-margin-top:calc(var(--head-h)+24px)] border-t border-[hsl(var(--rule))]";
const MARKER = "font-[var(--font-mono)] text-[11.5px] tracking-[0.16em] uppercase text-[hsl(var(--subtle))] mb-[22px]";

function CommandBlock() {
  return (
    <div className={`reveal d4 ${BLOCK}`} id="how">
      <div className={MARKER}>
        <span className="text-[hsl(var(--accent))]">01</span> / The command
      </div>
      <p className="text-[14px] leading-[1.6] text-[hsl(var(--muted))] mb-5 max-w-[46ch]">
        Sign in once over browser OAuth, then publish to hand off what your agent made. The same ID resolves to a page a
        person opens and a manifest another agent reads.
      </p>
      <CommandBox cmd={LOGIN_CMD} />
      <p className="mt-[14px] text-[12.5px] leading-[1.5] text-[hsl(var(--subtle))]">
        Browser OAuth provisions a scoped key on your machine. No key to copy or paste.
      </p>
      <CommandBox cmd={PUBLISH_CMD} />

      <div className="mt-[22px] grid gap-0">
        <div className="grid grid-cols-[72px_1fr] gap-4 items-baseline py-[14px] border-t border-[hsl(var(--rule))] first:border-t-0 first:pt-0">
          <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-[hsl(var(--subtle))]">
            Result
          </div>
          <div>
            <button
              type="button"
              className="inline-block text-left bg-transparent border-0 px-1 py-[2px] -mx-1 -my-[2px] rounded-[var(--radius-xs)] font-[var(--font-mono)] text-[13.5px] leading-[1.5] text-[hsl(var(--muted))] break-all [font-feature-settings:'zero'] [cursor:copy] transition-[background] duration-[140ms] ease-[var(--ease-out)] hover:bg-[hsl(var(--accent-tint))] data-[copied=true]:bg-[hsl(var(--accent)/0.22)]"
              data-clipboard={`${ARTIFACT_ORIGIN}${ARTIFACT_ID}`}
              aria-label={`Copy artifact URL: ${ARTIFACT_ORIGIN}${ARTIFACT_ID}`}
            >
              <span className="t-gesture" aria-hidden="true">
                {GESTURE_WIRE}
                <span className="t-gesture-node">{GESTURE_NODE}</span>
              </span>
              {ARTIFACT_ORIGIN}
              <span className="text-[hsl(var(--accent))]">{ARTIFACT_ID}</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-[72px_1fr] gap-4 items-baseline py-[14px] border-t border-[hsl(var(--rule))]">
          <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-[hsl(var(--subtle))]">
            Human
          </div>
          <div>
            <span className="font-[var(--font-mono)] text-[13.5px] leading-[1.5] text-[hsl(var(--muted))] break-all [font-feature-settings:'zero']">
              opens the page in a browser
            </span>
          </div>
        </div>
        <div className="grid grid-cols-[72px_1fr] gap-4 items-baseline py-[14px] border-t border-[hsl(var(--rule))]">
          <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-[hsl(var(--subtle))]">
            Agent
          </div>
          <div>
            <span className="font-[var(--font-mono)] text-[13.5px] leading-[1.5] text-[hsl(var(--muted))] break-all [font-feature-settings:'zero']">
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
        <span className="text-[hsl(var(--accent))]">02</span> / Why it holds up
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
    <li className="grid grid-cols-[48px_1fr] gap-5 py-[22px] items-start border-t border-[hsl(var(--rule))] first:border-t-0 first:pt-1">
      <span className="font-[var(--font-mono)] text-[13px] text-[hsl(var(--accent))] pt-[2px] [font-feature-settings:'zero']">
        {index.toString().padStart(2, "0")}
      </span>
      <div>
        <p className="font-[var(--font-ui)] font-semibold text-[16.5px] tracking-[-0.01em] leading-[1.3] text-[hsl(var(--foreground))] mb-[5px]">
          {feature.title}
        </p>
        <p className="text-[14px] leading-[1.55] text-[hsl(var(--muted))] m-0 max-w-[56ch] [&_.code]:font-[var(--font-mono)] [&_.code]:text-[0.9em] [&_.code]:text-[hsl(var(--foreground))] [&_.code]:bg-[hsl(var(--surface-3))] [&_.code]:px-[5px] [&_.code]:py-px [&_.code]:rounded-[var(--radius-sm)] [&_.code]:[font-feature-settings:'zero']">
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
        <span className="text-[hsl(var(--accent))]">03</span> / Get started
      </div>
      <CommandBox cmd={INSTALL_CMD} />
      <p className="text-[13.5px] leading-[1.55] text-[hsl(var(--subtle))] mt-[18px] mb-7">
        <b className="text-[hsl(var(--foreground))] font-semibold">Free to start.</b> Add{" "}
        <code className="font-[var(--font-mono)] text-[0.9em] text-[hsl(var(--foreground))] bg-[hsl(var(--surface-3))] px-[5px] py-px rounded-[var(--radius-sm)] [font-feature-settings:'zero']">
          --ephemeral
        </code>{" "}
        to publish with no account at all.
      </p>
      <a className={PRIMARY_CTA} href={SIGN_IN_URL}>
        Get started free
        <span
          className="transition-transform duration-[220ms] ease-[var(--ease-out)] group-hover:translate-x-[3px]"
          aria-hidden="true"
        >
          →
        </span>
      </a>
    </div>
  );
}

export function HomePage() {
  return (
    <main>
      <div className="max-w-[1240px] mx-auto px-[clamp(20px,4vw,72px)]">
        <div className="grid grid-cols-1 min-[900px]:grid-cols-[40%_60%] min-[900px]:items-start">
          <HeroPane />
          <DetailPane />
        </div>
      </div>
    </main>
  );
}
