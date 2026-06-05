type Props = {
  tone?: "solid" | "accent";
  withMark?: boolean;
};

/*
 * The canonical wordmark: `agent-paste.sh`. Hyphen in --accent, `.sh` TLD in
 * --subtle. Identical in structure and color roles to the apex marketing mark
 * (apps/apex/src/components/chrome.tsx + styles.ts .wordmark*), so the two
 * surfaces cannot drift. The `/` is a chrome breadcrumb separator (Topbar), not
 * part of the mark. See docs/specs/style-guide.md §6.2.
 */
export function Wordmark({ tone = "accent", withMark = true }: Props) {
  return (
    <span className="inline-flex items-center gap-[9px]">
      {withMark ? <img aria-hidden alt="" src="/brand-mark.png" className="h-[18px] w-[18px] rounded-[3px]" /> : null}
      <span
        className="font-display text-[15px] font-semibold text-[hsl(var(--foreground))]"
        style={{ letterSpacing: "-0.03em" }}
      >
        agent
        <span style={{ color: tone === "accent" ? "hsl(var(--accent))" : "inherit" }}>-</span>
        paste
        <span className="font-semibold text-[hsl(var(--subtle))]">.sh</span>
      </span>
    </span>
  );
}
