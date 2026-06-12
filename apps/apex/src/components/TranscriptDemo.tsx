import { EXAMPLE_STATIC_PAGE_PATH, TRANSCRIPT, type TranscriptLine } from "../copy";

// The home demo: a flat, hairline-bordered transcript shell (style-guide §8.1)
// showing one agent publish session. Terminal *behavior* (mono, prompt carets,
// copyable lines) without the terminal *look* — no window dots, no neon, no
// glow. Nothing animates.

// The result gesture echoes the brand mark on the home page: a caret-along-a-wire
// into an accent node. The wire is U+2500, deliberately NOT an em dash, so the
// no-em-dash rule and the banned-token test hold.
const GESTURE_WIRE = ">─";
const GESTURE_NODE = "●";

function Line({ line }: { line: TranscriptLine }) {
  switch (line.kind) {
    case "prompt":
      // Preserve newlines in the command so a backslash line-continuation renders
      // as two lines, like a real shell. The continuation indent lives in the
      // copy string after the "\\\n".
      return (
        <div className="t-line">
          <span className="text-accent select-none" aria-hidden="true">
            ${" "}
          </span>
          <span className="text-foreground font-medium whitespace-pre-wrap">{line.text}</span>
        </div>
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
      <div className="t-foot border-t border-rule px-4 py-3">
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
      </div>
    </div>
  );
}
