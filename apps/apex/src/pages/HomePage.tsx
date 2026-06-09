import { Prose } from "@agent-paste/ui";
import type { ReactNode } from "react";
import { TranscriptDemo } from "../components/TranscriptDemo";
import {
  FEATURES,
  type Feature,
  HERO,
  INSTALL_PS1_CMD,
  INSTALL_SH_CMD,
  LOGIN_CMD,
  MCP_BASE_URL,
  PUBLISH_CMD,
  SIGN_IN_URL,
} from "../copy";

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
// to [data-clipboard]). An optional label tags the box (e.g. the target OS); an
// optional prompt overrides the shell glyph (PowerShell is not a `$` shell).
function CommandBox({ cmd, label, prompt = "$" }: { cmd: string; label?: string; prompt?: string }) {
  return (
    <div className="border border-rule-strong rounded-sm bg-surface px-4 py-4 font-mono text-base [font-feature-settings:'zero']">
      {label ? (
        <div className="font-mono text-mono-sm tracking-eyebrow uppercase text-subtle mb-2" aria-hidden="true">
          {label}
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <code className="font-mono text-foreground break-all flex-1 min-w-0">
          <span className="text-accent select-none" aria-hidden="true">
            {prompt}{" "}
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
      {/* Canonical headline. Lives here, not in copy.ts, because it carries the
          one accent span. The sanctioned wording (brand guide §6.1) is fixed. */}
      <h1 className="reveal d2 font-display font-extrabold text-display-lg leading-tight tracking-tightest [font-feature-settings:'ss01'] text-foreground mb-8 text-balance min-[900px]:text-display-md min-[900px]:max-w-[12ch]">
        Your <span className="text-accent">agent</span> built it. Open it <span className="text-accent">anywhere</span>.
      </h1>
      <p className="reveal d3 text-lg leading-relaxed text-muted mb-8 max-w-[52ch] min-[900px]:text-lg min-[900px]:max-w-[38ch]">
        {HERO.lead}
      </p>
      <div className="reveal d4 flex items-center gap-6 flex-wrap">
        <HeroCta href={SIGN_IN_URL}>{HERO.primary.label}</HeroCta>
        <a
          className="font-ui text-base text-muted py-1 transition-colors duration-200 ease-out hover:text-foreground"
          href="/docs"
          data-agent-docs="/docs.md"
          data-agent-guide="/agents.md"
        >
          Read the docs
        </a>
      </div>
    </section>
  );
}

// Right pane: the reading column of hairline-ruled blocks. The demo set-piece
// leads (it is the feat of strength and sits at the top of this column, above
// the fold on desktop); the reasons-to-believe and get-started blocks follow.
function DetailPane() {
  return (
    <section className="pt-10 pb-2 min-w-0 min-[900px]:[padding:var(--pane-pad-y)_0_64px_var(--pane-gutter)]">
      <DemoBlock />
      <CommandBlock />
      <ReasonsBlock />
      <McpBlock />
      <ClosingBlock />
    </section>
  );
}

// A hairline-ruled reading block. The first block has no top padding; subsequent
// blocks get a top rule. scroll-margin keeps the nav anchor clear of the header.
const BLOCK =
  "py-[clamp(38px,5vh,56px)] [scroll-margin-top:calc(var(--head-h)+24px)] border-t border-rule first:border-t-0 first:pt-0";
// Display-size title that opens the reading column (it pairs across the gutter
// with the hero on the left). Smaller subsection headers below use MARKER.
const TITLE =
  "font-display font-semibold text-display-sm leading-snug tracking-tighter text-foreground mb-6 text-balance max-w-[20ch]";
const MARKER = "font-mono text-mono-sm tracking-eyebrow uppercase text-subtle mb-6";

// The lead set-piece: a flat transcript shell showing an agent build a folder
// and publish it into a shareable link. This is the proof, so it opens the
// reading column under the display title.
function DemoBlock() {
  return (
    <div className={`reveal d3 ${BLOCK}`} id="demo">
      <h2 className={TITLE}>
        Build it in your agent. <span className="text-accent">Publish</span> in one line.
      </h2>
      <p className="text-base leading-relaxed text-muted mb-8 max-w-[46ch]">
        Your agent renders a folder, in whatever tool you already use. One command publishes it and hands back a link a
        person can open and another agent can read.
      </p>
      <TranscriptDemo />
    </div>
  );
}

// The how-to beat: the two commands in the order you run them. Login first
// (browser OAuth, no key to paste), then publish. Even spacing between boxes.
function CommandBlock() {
  return (
    <div className={`reveal d4 ${BLOCK}`} id="how">
      <div className={MARKER}>The command</div>
      <p className="text-base leading-relaxed text-muted mb-6 max-w-[46ch]">
        Sign in once over browser OAuth, then publish to hand off what your agent made. The same Artifact ID resolves to
        a page a person opens and a manifest another agent reads.
      </p>
      <div className="flex flex-col gap-3">
        <CommandBox cmd={LOGIN_CMD} />
        <CommandBox cmd={PUBLISH_CMD} />
      </div>
      <p className="mt-4 text-mono leading-normal text-subtle max-w-[52ch]">
        Browser OAuth provisions a scoped key on your machine. No key to copy or paste.
      </p>
    </div>
  );
}

function ReasonsBlock() {
  return (
    <div className={`reveal d5 ${BLOCK}`} id="features">
      <div className={MARKER}>Why the link holds up</div>
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

// The no-shell door. CLI leads the page; this is the fallback for web chats that
// have no terminal (ChatGPT, Claude, Gemini): connect the MCP server once and the
// agent publishes and reads from there. Framed by what it lets you do, not the
// acronym (brand guide: MCP is the mechanism, never the headline).
function McpBlock() {
  const endpoint = MCP_BASE_URL.replace(/^https?:\/\//, "");
  return (
    <div className={`reveal d6 ${BLOCK}`} id="mcp">
      <div className={MARKER}>No shell? Connect from any chat</div>
      <p className="text-base leading-relaxed text-muted mb-6 max-w-[46ch]">
        In a web chat with no terminal, like ChatGPT, Claude, or Gemini, add the server once. The agent publishes and
        reads Artifacts from there, the same ones the CLI produces.
      </p>
      <div className="flex items-center justify-between gap-4 border border-rule-strong rounded-sm bg-surface px-4 py-4 font-mono text-base [font-feature-settings:'zero']">
        <code className="font-mono whitespace-nowrap overflow-x-auto flex-1 min-w-0">
          <span className="text-subtle select-none flex-none" aria-hidden="true">
            https://
          </span>
          <span className="text-accent">{endpoint}</span>
        </code>
        <button
          type="button"
          className="flex-none font-mono text-mono-sm tracking-wider uppercase text-subtle bg-transparent border border-rule rounded-xs px-2 py-1 cursor-pointer transition-[color,border-color] duration-[180ms] ease-out hover:text-foreground hover:border-rule-strong data-[copied=true]:text-accent data-[copied=true]:border-accent"
          data-clipboard={MCP_BASE_URL}
          aria-label={`Copy the MCP server URL: ${MCP_BASE_URL}`}
        >
          Copy
        </button>
      </div>
      <p className="mt-4 text-mono leading-normal text-subtle max-w-[52ch]">
        Add it as a remote MCP server in your client.{" "}
        <a
          className="text-muted underline decoration-rule-strong hover:text-foreground"
          href="/docs"
          data-agent-docs="/docs/mcp.md"
          data-agent-guide="/agents.md"
        >
          See the setup docs
        </a>
        .
      </p>
    </div>
  );
}

function ClosingBlock() {
  return (
    <div className={`reveal d6 ${BLOCK}`} id="docs">
      <div className={MARKER}>Start signed in, or fallback accountless</div>
      <div className="flex flex-col gap-3">
        <CommandBox label="macOS / Linux" cmd={INSTALL_SH_CMD} />
        <CommandBox label="Windows" prompt=">" cmd={INSTALL_PS1_CMD} />
      </div>
      <p className="text-base leading-relaxed text-subtle mt-4 mb-8 max-w-[52ch]">
        <b className="text-foreground font-semibold">Free to start.</b> Add{" "}
        <code className="font-mono text-[0.9em] text-foreground bg-surface-3 px-1 py-px rounded-sm [font-feature-settings:'zero']">
          --ephemeral
        </code>{" "}
        only when no login is available: text, images, static HTML, no JS, kept for 24 hours, with a one-time link to
        claim it into your Workspace.
      </p>
      <HeroCta href={SIGN_IN_URL}>Get started free</HeroCta>
    </div>
  );
}

export function HomePage() {
  return (
    <main
      data-agent-guide="/agents.md"
      data-agent-docs="/docs.md"
      data-agent-summary="/llms.txt"
      data-agent-corpus="/llms-full.txt"
    >
      <div className="max-w-[1280px] mx-auto px-[clamp(20px,4vw,72px)]">
        <div className="grid grid-cols-1 min-[900px]:grid-cols-[40%_60%] min-[900px]:items-start">
          <HeroPane />
          <DetailPane />
        </div>
      </div>
    </main>
  );
}
