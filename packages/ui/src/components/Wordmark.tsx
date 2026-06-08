type Props = {
  /** Hyphen in --accent (default) or inherit the surrounding color. */
  tone?: "solid" | "accent";
  /** Show the brand mark image before the wordmark. */
  withMark?: boolean;
  /** Smaller footer/inline size. */
  small?: boolean;
};

/*
 * The canonical wordmark: `agent-paste.sh`. Hyphen in --accent, `.sh` TLD in
 * --subtle. The single copy rendered by both the web dashboard and the apex
 * marketing site, so the mark cannot drift. The `/` breadcrumb separator (web
 * Topbar) is chrome, not part of the mark. See docs/specs/style-guide.md §6.2.
 */
export function Wordmark({ tone = "accent", withMark = true, small = false }: Props) {
  return (
    <span className="inline-flex items-center gap-[9px]">
      {withMark ? (
        <img
          aria-hidden
          alt=""
          src="/brand-mark.png"
          className={small ? "h-[16px] w-[16px] rounded-[3px]" : "h-[18px] w-[18px] rounded-[3px]"}
        />
      ) : null}
      <span
        className={
          small
            ? "font-display text-[14px] font-semibold text-[hsl(var(--foreground))]"
            : "font-display text-[15px] font-semibold text-[hsl(var(--foreground))]"
        }
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
