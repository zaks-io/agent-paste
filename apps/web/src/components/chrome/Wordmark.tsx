type Props = {
  tone?: "solid" | "accent";
  withMark?: boolean;
};

export function Wordmark({ tone = "accent", withMark = true }: Props) {
  return (
    <span className="inline-flex items-center gap-[9px]">
      {withMark ? <img aria-hidden alt="" src="/brand-mark.png" className="h-[18px] w-[18px] rounded-[3px]" /> : null}
      <span
        className="font-display text-[15px] font-semibold text-[hsl(var(--foreground))]"
        style={{ letterSpacing: "-0.03em" }}
      >
        agent
        <span style={{ color: tone === "accent" ? "hsl(var(--accent))" : "inherit" }}>/</span>
        paste
      </span>
    </span>
  );
}
