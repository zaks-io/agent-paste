import { SOURCE_REPOSITORY } from "../copy";

// Public repo callout for the About and How-it-works pages. Rendered as a prose
// block so it sits flush with the surrounding section copy.
const INLINE_LINK =
  "text-[hsl(var(--foreground))] underline decoration-[hsl(var(--accent)/0.4)] decoration-1 underline-offset-[3px] hover:decoration-[hsl(var(--accent))]";

export function SourceRepository() {
  return (
    <article className="border-t border-[hsl(var(--rule))] py-[clamp(28px,4vh,40px)] first:border-t-0 first:pt-0">
      <h2 className="m-0 font-display text-[clamp(20px,2.2vw,26px)] font-bold leading-[1.2] tracking-[-0.02em] text-[hsl(var(--foreground))]">
        Source
      </h2>
      <p className="mt-[14px] text-[15.5px] leading-[1.65] text-[hsl(var(--muted))]">
        The repo is{" "}
        <a className={INLINE_LINK} href={SOURCE_REPOSITORY.href}>
          {SOURCE_REPOSITORY.slug}
        </a>{" "}
        for anyone curious.
      </p>
    </article>
  );
}
