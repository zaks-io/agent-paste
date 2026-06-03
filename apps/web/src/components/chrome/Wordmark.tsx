type Props = {
  tone?: "solid" | "accent";
  withMark?: boolean;
};

/*
 * A small square seal + the wordmark. The seal is the registrar's stamp:
 * a violet block with a punched dot. Square, never a pill.
 */
export function Wordmark({ tone = "accent", withMark = true }: Props) {
  return (
    <span className="inline-flex items-center gap-[9px]">
      {withMark ? (
        <span aria-hidden className="grid h-[18px] w-[18px] place-items-center rounded-[3px] bg-[hsl(var(--accent))]">
          <span className="h-[5px] w-[5px] rounded-full bg-[hsl(var(--accent-foreground))]" />
        </span>
      ) : null}
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
