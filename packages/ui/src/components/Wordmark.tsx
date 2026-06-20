type Props = {
  /** Show the brand mark image before the wordmark. */
  withMark?: boolean;
  /** Smaller footer/inline size. */
  small?: boolean;
};

/*
 * The canonical wordmark: `agent-paste.sh`, rendered as a command-line token in
 * the mono face (per design mockup m5-cross). Hyphen in --accent, `.sh` TLD in
 * --subtle. The single copy rendered by both the web dashboard and the apex
 * marketing site, so the mark cannot drift. See docs/specs/style-guide.md §6.2.
 */
export function Wordmark({ withMark = false, small = false }: Props) {
  return (
    <span className="inline-flex items-center gap-2">
      {withMark ? <img aria-hidden alt="" src="/brand-mark.png" className="h-[16px] w-[16px] rounded-[3px]" /> : null}
      <span
        className={
          small
            ? "font-mono text-base font-medium tracking-tight whitespace-nowrap text-foreground"
            : "font-mono text-h3 font-medium tracking-tight whitespace-nowrap text-foreground"
        }
      >
        agent
        <span className="text-accent">-</span>
        paste
        <span className="text-subtle">.sh</span>
      </span>
    </span>
  );
}
