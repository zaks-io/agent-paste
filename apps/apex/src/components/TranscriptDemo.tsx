import {
  DEMO_RUN,
  EXAMPLE_PROMPT,
  EXAMPLE_PROMPT_VARIANT,
  SIGN_IN_URL,
  TRANSCRIPT,
  type TranscriptLine,
} from "../copy";

// The home demo: a flat, hairline-bordered transcript shell (style-guide §8.1)
// showing one agent session. Terminal *behavior* (mono, prompt carets, reasoning,
// commands) without the terminal *look* — no window dots, no neon, no glow.
//
// Every line renders at build time and is fully visible by default, so the
// transcript is intact for no-JS visitors, crawlers, and the render tests. The
// animation is a progressive enhancement: client.ts arms the shell (data-demo)
// only when motion is allowed, hides everything after the prompt, and reveals the
// run on the inline Execute button that sits right under the prompt. The Execute
// button vanishes on click; once the run finishes, a circular replay control
// appears in the head. Each animated line carries `t-step`; the fade/caret/jitter
// live in apex.css + client.ts.

// The inline preview shows only the first couple of report rows and fades them out
// at the bottom (apex.css .t-preview-fade), so it reads as a truncated peek at a
// longer artifact rather than the whole page. Two rows keeps the panel short enough
// that the whole "Done. Here's your link" handoff + preview lands as the final
// frame inside the shell with no scroll.
const PREVIEW_ROWS = 2;

// Keep the wordmark from breaking at its hyphen ("agent-" / "paste.sh"). Splits the
// prompt on the wordmark token (capturing group keeps the delimiter) and wraps each
// occurrence in a no-wrap span; the rest of the prompt still wraps normally. Matches
// the .sh form and the bare wordmark.
function renderPromptText(text: string) {
  return text.split(/(agent-paste(?:\.sh)?)/g).map((part, i) =>
    part.startsWith("agent-paste") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: split parts are positional and static.
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function Line({ line }: { line: TranscriptLine }) {
  switch (line.kind) {
    case "prompt":
      // One runnable command line: `$ agent "…"` flows as a single continuous,
      // naturally-wrapping line of terminal text — no separate boxes, no forced
      // breaks between the `$ agent "` framing, the prompt, and the closing `"`.
      // The whole command is one inline <button> (click-to-copy); the `$`, `agent`,
      // and quotes are dim inline spans within that flow. It carries the same
      // data-claim-prompt-variant as the labeled "Copy prompt" button so BOTH copy
      // the identical text — the prompt plus the appended --claim-code line — and
      // both fire the funnel attribution.
      return (
        <button
          type="button"
          className="t-line t-step t-prompt-copy relative block w-full text-left whitespace-pre-wrap leading-relaxed text-foreground border-0 bg-transparent cursor-pointer rounded-xs group/prompt"
          data-clipboard={EXAMPLE_PROMPT}
          data-claim-prompt-variant={EXAMPLE_PROMPT_VARIANT}
          title="Click to copy this prompt"
          aria-label={`Copy the prompt to paste into your agent: ${EXAMPLE_PROMPT}`}
        >
          <span className="text-subtle select-none" aria-hidden="true">
            $ agent &quot;
          </span>
          <span className="underline decoration-dotted decoration-subtle underline-offset-4 transition-colors duration-[140ms] ease-out group-hover/prompt:decoration-accent group-data-[copied=true]/prompt:text-accent">
            {renderPromptText(EXAMPLE_PROMPT)}
          </span>
          <span className="text-subtle select-none" aria-hidden="true">
            &quot;
          </span>
          {/* Click-to-copy hint: reliably tells the reader the prompt copies on
              click (more discoverable than the slow native title). Positioned
              entirely by CSS so the locked style-src CSP stays clean. */}
          <span
            className="t-prompt-tip pointer-events-none absolute rounded-xs border border-rule-strong bg-surface px-2 py-0.5 font-mono text-mono-sm tracking-wider uppercase text-subtle opacity-0 transition-opacity duration-[140ms] ease-out group-hover/prompt:opacity-100 group-focus-visible/prompt:opacity-100"
            aria-hidden="true"
          >
            <span className="group-data-[copied=true]/prompt:hidden">Click to copy</span>
            <span className="hidden text-accent group-data-[copied=true]/prompt:inline">Copied</span>
          </span>
        </button>
      );
    case "reason":
      // First-person agent narration, marked with Claude Code's ⏺ glyph so it
      // reads as the agent's own voice. Muted, not dim, so it's the through-line.
      return (
        <div className="t-line t-step text-muted" data-kind="reason" data-wait={line.wait}>
          <span className="text-accent select-none" aria-hidden="true">
            ⏺{" "}
          </span>
          {line.text}
        </div>
      );
    case "tool":
      // A collapsed tool call, the signature of a real Claude Code feed: the tool
      // invocation on its own muted line, then the single-line result on a `⎿`
      // gutter beneath it, with an optional faint "(ctrl+o to expand)" tail. The
      // pair is one `t-step` so it reveals as a single beat in the animation.
      return (
        <div className="t-line t-step" data-kind="tool" data-wait={line.wait}>
          <div className="text-muted">
            <span className="text-accent select-none" aria-hidden="true">
              ⏺{" "}
            </span>
            {line.text}
          </div>
          <div className="text-subtle pl-[1.6ch]">
            <span className="select-none" aria-hidden="true">
              ⎿{" "}
            </span>
            {line.result}
            {line.hint ? <span className="text-faint">{`  ${line.hint}`}</span> : null}
          </div>
        </div>
      );
    case "cmd":
      // A shell command the agent runs, with a caret. The command text is the
      // foreground so it pops against the dim reasoning/output around it.
      return (
        <div className="t-line t-step text-foreground" data-kind="cmd" data-wait={line.wait}>
          <span className="text-subtle select-none" aria-hidden="true">
            ${" "}
          </span>
          {line.text}
        </div>
      );
    case "comment":
      return (
        <div className="t-line t-step text-subtle" data-kind="comment" data-wait={line.wait}>
          {line.text}
        </div>
      );
    case "success":
      return (
        <div className="t-line t-step text-success" data-kind="success" data-wait={line.wait}>
          <span className="select-none" aria-hidden="true">
            ✓{" "}
          </span>
          {line.text}
        </div>
      );
    case "output":
      return (
        <div className="t-line t-step text-subtle pl-[1.6ch]" data-kind="output" data-wait={line.wait}>
          {line.text}
        </div>
      );
    case "link":
      // The handed-back no-login link, on its own line right before the preview
      // opens below it. Styled like a URL (accent), not clickable — the demo opens
      // nothing; the preview's address bar echoes the same URL.
      return (
        <div className="t-line t-step break-all text-accent" data-kind="link" data-wait={line.wait}>
          {line.url}
        </div>
      );
    case "preview":
      // The payoff: a miniature of the real /al access-link viewer. A narrow,
      // fixed-width "viewer" surface (the iframe area) with the wordmark brand bar
      // pinned bottom-left, exactly the collapsed state of the real
      // AccessLinkBrandBar (wordmark only, no URL). apex.css inverts the frame's
      // theme against the page (light frame on the dark site, and vice versa) so it
      // reads as a separate opened page. It is a rendered panel, not a typed line,
      // so apex.css also suppresses the trailing caret on it.
      return (
        <figure
          className="t-line t-step t-preview m-0 mt-3"
          data-kind="preview"
          data-wait={line.wait}
          aria-label={`Inline preview of the published artifact: ${line.title}`}
        >
          <div className="t-preview-frame relative mx-auto w-full max-w-[384px] overflow-hidden rounded-md border border-rule-strong bg-background">
            {/* A minimal browser address bar so the snippet reads as a real opened
                page. Its fill is a distinctly grayer shade (t-preview-bar in apex.css)
                than the page body so it reads as chrome; the dots and URL field sit on
                it. The URL is the access link, truncated to fit (no fragment). */}
            <div className="t-preview-bar flex items-center gap-2 border-b border-rule-strong px-3 py-2">
              <span className="flex flex-none items-center gap-1.5" aria-hidden="true">
                <span className="t-preview-dot h-2 w-2 rounded-full" />
                <span className="t-preview-dot h-2 w-2 rounded-full" />
                <span className="t-preview-dot h-2 w-2 rounded-full" />
              </span>
              <span className="t-preview-url min-w-0 flex-1 truncate rounded-sm border border-rule-strong px-2 py-0.5 font-mono text-mono-sm text-muted">
                {line.url}
              </span>
            </div>
            <div className="t-preview-page px-4 pt-3 pb-8">
              <p className="t-preview-title font-display font-semibold text-h3 leading-snug tracking-tight text-foreground">
                {line.title}
              </p>
              {/* A peek at the report body that fades out at the bottom (t-preview-fade
                  mask in apex.css), implying the artifact continues past the snippet —
                  no explicit "more" label. */}
              <ul className="t-preview-rows t-preview-fade mt-3 list-none m-0 p-0">
                {line.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and static.
                  <li key={i} className="t-preview-row grid grid-cols-[1.6rem_1fr] gap-2 border-t border-rule py-1.5">
                    <span className="font-mono text-mono-sm text-accent [font-feature-settings:'zero']">
                      {(i + 1).toString().padStart(2, "0")}
                    </span>
                    {/* truncate so a row stays a single line: this is preview chrome,
                        a one-line glimpse, never a wrapping paragraph. */}
                    <span className="min-w-0 truncate text-xs leading-snug text-muted">{row}</span>
                  </li>
                ))}
              </ul>
            </div>
            <span
              className="t-preview-brandbar absolute bottom-2 left-2 inline-flex items-center rounded-sm border border-rule-strong bg-background px-2 py-1 font-mono text-mono-sm font-medium text-foreground"
              aria-hidden="true"
            >
              agent<span className="text-accent">-</span>paste<span className="text-subtle">.sh</span>
            </span>
          </div>
        </figure>
      );
  }
}

// The transcript splits at the prompt: the prompt line is always shown, the
// inline Execute button sits right under it, and everything after it is what the
// run reveals. TRANSCRIPT always leads with the prompt line.
const PROMPT_LINE = TRANSCRIPT[0];
const RUN_LINES = TRANSCRIPT.slice(1);
const lineKey = (line: TranscriptLine) => {
  if (line.kind === "preview") return `preview:${line.title}`;
  if (line.kind === "link") return `link:${line.url}`;
  return `${line.kind}:${line.text}`;
};

export function TranscriptDemo() {
  if (!PROMPT_LINE) return null;
  return (
    <div className="t-shell border border-rule-strong rounded-md bg-surface overflow-hidden" data-demo>
      <div className="t-head flex items-center justify-between gap-3 px-4 py-2 border-b border-rule">
        <span className="font-mono text-mono-sm tracking-eyebrow uppercase text-subtle">demo session</span>
        {/* Replay: a circular refresh control that appears in the head only after
            the run has played once (data-demo="done", styled in apex.css). It is
            hidden by default so no-JS visitors never see an inert control. */}
        <button
          type="button"
          data-demo-replay
          className="t-replay inline-flex items-center justify-center text-subtle bg-transparent border-0 cursor-pointer hover:text-foreground"
          aria-label={DEMO_RUN.replay}
          title={DEMO_RUN.replay}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="square"
            />
          </svg>
        </button>
      </div>
      <div className="t-body font-mono text-mono leading-[1.85] px-4 py-4 bg-background text-foreground [font-feature-settings:'zero'] overflow-x-clip min-h-[136px] max-h-[290px] overflow-y-auto">
        <Line line={PROMPT_LINE} />
        {/* Execute affordance: a real-looking button, set a little lower under the
            prompt so it reads as the deliberate "run this" action. client.ts shows
            it on arm and hides it on click (data-demo="playing"/"done"). */}
        <button
          type="button"
          data-demo-run
          className="t-run group mt-4 inline-flex items-center gap-2 rounded-xs border border-rule-strong bg-surface px-3 py-1.5 font-mono text-mono-sm tracking-wider uppercase text-foreground no-underline cursor-pointer transition-colors duration-[140ms] ease-out hover:border-accent hover:bg-accent-tint"
        >
          <span className="text-accent" aria-hidden="true">
            ▶
          </span>
          {DEMO_RUN.execute}
        </button>
        {RUN_LINES.map((line) => (
          <Line key={lineKey(line)} line={line} />
        ))}
      </div>
      {/* The footer rail. The Copy prompt button anchors the bottom-left as the
          primary call to action (white default label so it reads as the ask, not an
          aside); "claim it to keep" is the post-copy funnel step on the right. */}
      <div className="t-foot border-t border-rule px-4 py-3 flex items-center justify-between gap-4">
        {/* The labeled copy affordance. Clicking copies the bare EXAMPLE_PROMPT (the
            instruction to paste into your own agent), not the `agent "..."` shell
            wrapper. This button carries the funnel attribution; the inline prompt-text
            copy in the body is the convenience twin. The shared [data-clipboard]
            script (client.ts) copies and sets data-copied, flipping the label to
            "Copied". The label is a fixed-size two-state grid stack so the swap never
            reflows the rail. */}
        <button
          type="button"
          className="t-copy group inline-flex items-center bg-transparent border-0 cursor-pointer"
          data-clipboard={EXAMPLE_PROMPT}
          data-claim-prompt-variant={EXAMPLE_PROMPT_VARIANT}
          title="Copy the prompt to paste into your agent"
          aria-label={`Copy the prompt to paste into your agent: ${EXAMPLE_PROMPT}`}
        >
          <span className="grid font-mono text-mono-sm tracking-eyebrow uppercase" aria-hidden="true">
            <span className="col-start-1 row-start-1 text-foreground group-hover:text-accent group-data-[copied=true]:invisible">
              Copy prompt
            </span>
            <span className="col-start-1 row-start-1 invisible text-accent group-data-[copied=true]:visible">
              Copied
            </span>
          </span>
        </button>
        <a
          className="group inline-flex items-center gap-2 font-mono text-mono-sm text-muted no-underline transition-colors duration-200 ease-out hover:text-foreground"
          href={SIGN_IN_URL}
        >
          claim it to keep
          <span
            className="transition-transform duration-[220ms] ease-out group-hover:translate-x-[3px]"
            aria-hidden="true"
          >
            →
          </span>
        </a>
      </div>
    </div>
  );
}
