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

// The result gesture echoes the brand mark on the home page: a caret-along-a-wire
// into an accent node. The wire is U+2500, deliberately NOT an em dash, so the
// no-em-dash rule and the banned-token test hold.
const GESTURE_WIRE = ">─";
const GESTURE_NODE = "●";

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
      // The whole command is one inline <button> (click-to-copy, copies the bare
      // EXAMPLE_PROMPT); the `$`, `agent`, and quotes are dim inline spans within
      // that flow. The labeled toolbar "Copy prompt" button carries the funnel
      // attribution; this is the inline twin.
      return (
        <button
          type="button"
          className="t-line t-step t-prompt-copy relative block w-full text-left whitespace-pre-wrap leading-relaxed text-foreground border-0 bg-transparent cursor-pointer rounded-xs group/prompt"
          data-clipboard={EXAMPLE_PROMPT}
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
              click (more discoverable than the slow native title). Follows the
              cursor — client.ts writes the pointer position into --tip-x/--tip-y
              and apex.css (.t-prompt-tip) places it just below-right of the
              cursor. Fades in on hover/focus; flips to a confirmation while
              data-copied is set. Non-interactive. */}
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
    case "result":
      return (
        <a
          className="t-line t-step t-result block break-all text-muted no-underline rounded-xs px-1 -mx-1 transition-[background] duration-[140ms] ease-out hover:bg-accent-tint"
          data-kind="result"
          data-wait={line.wait}
          href={line.href}
          aria-label={`Open the static example shown by this Access Link: ${line.url}`}
        >
          <span className="t-gesture" aria-hidden="true">
            {GESTURE_WIRE}
            <span className="t-gesture-node">{GESTURE_NODE}</span>
          </span>
          <span className="text-subtle">https://</span>
          <span className="text-accent">{line.url}</span>
        </a>
      );
  }
}

// The transcript splits at the prompt: the prompt line is always shown, the
// inline Execute button sits right under it, and everything after it is what the
// run reveals. TRANSCRIPT always leads with the prompt line.
const PROMPT_LINE = TRANSCRIPT[0];
const RUN_LINES = TRANSCRIPT.slice(1);
const lineKey = (line: TranscriptLine) => (line.kind === "result" ? line.url : `${line.kind}:${line.text}`);

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
      <div className="t-body font-mono text-mono leading-[1.85] px-4 py-4 bg-background text-foreground [font-feature-settings:'zero'] overflow-x-clip min-h-[136px] max-h-[300px] overflow-y-auto">
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
