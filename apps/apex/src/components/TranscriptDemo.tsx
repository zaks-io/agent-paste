import {
  EXAMPLE_PROMPT,
  EXAMPLE_PROMPT_VARIANT,
  EXAMPLE_STATIC_PAGE_PATH,
  SIGN_IN_URL,
  TRANSCRIPT,
  type TranscriptLine,
} from "../copy";

// The home demo: a flat, hairline-bordered transcript shell (style-guide §8.1)
// showing one agent publish session. Terminal *behavior* (mono, prompt carets,
// copyable lines) without the terminal *look* — no window dots, no neon, no
// glow. Nothing animates.

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
      // The page's single copy affordance. Clicking copies the bare EXAMPLE_PROMPT
      // (the instruction to paste into your own agent), not the `agent "..."` shell
      // wrapper. The ONLY highlighted thing is the prompt string itself: it sits in a
      // subtle tinted box so it reads as "this chunk is what you copy". The `$ agent "`
      // / `"` framing stays plain dim, non-selectable, with no background, so nothing
      // implies the `agent` command runs. There is no row-level hover background.
      // The shared [data-clipboard] script (client.ts) copies and sets data-copied,
      // flipping the label to "Copied". Only one prompt line exists.
      // The label is a fixed-size two-state stack (grid overlay) so swapping its text
      // never changes width and the line never reflows.
      return (
        <button
          type="button"
          className="t-line group flex w-full items-start gap-3 text-left bg-transparent border-0 cursor-pointer"
          data-clipboard={EXAMPLE_PROMPT}
          data-claim-prompt-variant={EXAMPLE_PROMPT_VARIANT}
          aria-label={`Copy the prompt to paste into your agent: ${EXAMPLE_PROMPT}`}
        >
          <span className="min-w-0 whitespace-pre-wrap leading-relaxed">
            <span className="text-subtle select-none" aria-hidden="true">
              $ agent{" "}
            </span>
            <span className="text-subtle select-none" aria-hidden="true">
              "
            </span>
            <span className="rounded-xs bg-accent-tint px-1 py-0.5 text-foreground font-medium box-decoration-clone transition-[background] duration-[140ms] ease-out group-hover:bg-accent/25">
              {renderPromptText(EXAMPLE_PROMPT)}
            </span>
            <span className="text-subtle select-none" aria-hidden="true">
              "
            </span>
          </span>
          <span
            className="ml-auto flex-none self-start grid font-mono text-mono-sm uppercase tracking-wider"
            aria-hidden="true"
          >
            <span className="col-start-1 row-start-1 text-subtle group-hover:text-foreground group-data-[copied=true]:invisible">
              Copy prompt
            </span>
            <span className="col-start-1 row-start-1 invisible text-accent group-data-[copied=true]:visible">
              Copied
            </span>
          </span>
        </button>
      );
    case "comment":
      return <div className="t-line text-faint">{line.text}</div>;
    case "success":
      return (
        <div className="t-line text-success">
          <span className="select-none" aria-hidden="true">
            ✓{" "}
          </span>
          {line.text}
        </div>
      );
    case "output":
      return <div className="t-line text-subtle pl-[1.2ch]">{line.text}</div>;
    case "result":
      return (
        <a
          className="t-line t-result block break-all text-muted no-underline rounded-xs px-1 -mx-1 transition-[background] duration-[140ms] ease-out hover:bg-accent-tint"
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

export function TranscriptDemo() {
  return (
    <div className="t-shell border border-rule-strong rounded-md bg-surface overflow-hidden">
      <div className="t-head flex items-center px-4 py-2 border-b border-rule">
        <span className="font-mono text-mono-sm tracking-eyebrow uppercase text-subtle">agent session</span>
      </div>
      <div className="t-body font-mono text-mono leading-[1.85] px-4 py-4 bg-background text-foreground [font-feature-settings:'zero'] overflow-x-auto">
        {TRANSCRIPT.map((line) => (
          <Line key={line.kind === "result" ? line.url : `${line.kind}:${line.text}`} line={line} />
        ))}
      </div>
      {/* The next funnel step rail: test what a published link looks like, then
          claim it to keep it. The copy affordance moved onto the prompt line above,
          so this footer carries the post-copy path, not a second copy button. */}
      <div className="t-foot border-t border-rule px-4 py-3 flex items-center justify-between gap-4">
        <a
          className="group inline-flex items-center gap-2 font-mono text-mono-sm text-muted no-underline transition-colors duration-200 ease-out hover:text-foreground"
          href={EXAMPLE_STATIC_PAGE_PATH}
        >
          open the example
          <span
            className="transition-transform duration-[220ms] ease-out group-hover:translate-x-[3px]"
            aria-hidden="true"
          >
            →
          </span>
        </a>
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
