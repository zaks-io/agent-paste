import { cn } from "@agent-paste/ui";
import type { ReactNode } from "react";

/**
 * Shared apex marketing primitives. Every marketing page (About, HowItWorks,
 * Pricing, Legal, Docs index, Docs page) was hand-building the same eyebrow +
 * headline + summary section and the same section <h2> inline. They compose these
 * now, so the page header and section heading look is defined once. Restyling a
 * marketing header is a one-file edit here, not a sweep across six pages.
 *
 * These are apex-only (marketing voice); they live here, not in @agent-paste/ui,
 * because the web dashboard has no call site for them (deletion test).
 */

/** Mono uppercase rail label — the eyebrow above every page title, with a live accent dot. */
export function Eyebrow({ children, dot = true }: { children: ReactNode; dot?: boolean }) {
  return (
    <p className="m-0 inline-flex items-center gap-2 font-mono text-mono-sm font-medium uppercase leading-none tracking-eyebrow text-subtle">
      {dot ? <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent" aria-hidden="true" /> : null}
      {children}
    </p>
  );
}

/**
 * The page-top header: eyebrow, display headline, summary, optional action row.
 * `eyebrow` accepts a node so a page can pass a back-link instead of a label.
 */
export function PageHeader({
  eyebrow,
  title,
  summary,
  actions,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col items-start gap-4 border-b border-rule pb-[clamp(32px,5vh,48px)]">
      {typeof eyebrow === "string" ? <Eyebrow>{eyebrow}</Eyebrow> : eyebrow}
      <h1 className="m-0 max-w-[18ch] font-display text-display-md font-extrabold leading-tight tracking-tightest text-balance text-foreground [font-feature-settings:'ss01']">
        {title}
      </h1>
      {summary ? <p className="m-0 max-w-[60ch] text-lg leading-relaxed text-muted">{summary}</p> : null}
      {actions ? <div className="flex flex-wrap gap-x-4 gap-y-2">{actions}</div> : null}
      {children}
    </section>
  );
}

/** A section <h2>. `bar` prepends the accent tick used in the docs article. */
export function SectionHeading({ children, bar = false, id }: { children: ReactNode; bar?: boolean; id?: string }) {
  return (
    <h2
      id={id}
      className={cn(
        "m-0 font-display text-display-sm font-bold leading-snug tracking-tighter text-foreground",
        bar && "flex items-baseline gap-3",
      )}
    >
      {bar ? (
        <span
          className="inline-block h-[0.7em] w-[3px] flex-none translate-y-px rounded-xs bg-accent"
          aria-hidden="true"
        />
      ) : null}
      {children}
    </h2>
  );
}

/**
 * A hairline-ruled article block: top rule, fluid vertical padding, no rule on the
 * first. `scrollAnchor` adds the header-clearance scroll margin for anchored docs
 * sections. Wraps the repeated `border-t … first:border-t-0 first:pt-0` string.
 */
export function ProseBlock({
  children,
  id,
  scrollAnchor = false,
}: {
  children: ReactNode;
  id?: string;
  scrollAnchor?: boolean;
}) {
  return (
    <article
      id={id}
      className={cn(
        "border-t border-rule py-[clamp(28px,4vh,40px)] first:border-t-0 first:pt-0",
        scrollAnchor && "scroll-mt-[calc(var(--head-h,64px)+24px)]",
      )}
    >
      {children}
    </article>
  );
}

/** Foreground text with an accent-tinted underline — the inline-link voice in prose. */
export const INLINE_LINK_CLASS =
  "text-foreground underline decoration-accent/40 decoration-[1px] underline-offset-[3px] " +
  "transition-colors hover:decoration-accent";

/**
 * The boxed comparison table (docs reference tables + the pricing comparison).
 * One source so the two surfaces match. This is a different role from the shared
 * dashboard <Table> (a borderless data grid), so it's its own thing, not a retrofit.
 */
export const TABLE_WRAP_CLASS = "mt-4 overflow-x-auto rounded-sm border border-rule";
export const TABLE_CLASS = "w-full min-w-[560px] border-collapse text-base leading-normal";
export const TH_CLASS = "border-b border-rule bg-surface px-3 py-3 text-left align-top font-semibold text-foreground";
export const TD_CLASS = "border-b border-rule px-3 py-3 text-left align-top text-muted";

/** A mono rail link (Docs index / Markdown / Full text), dim with an accent underline. */
export function RailLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="font-mono text-mono text-muted underline decoration-accent/40 decoration-[1px] underline-offset-[3px] transition-colors hover:text-accent hover:decoration-accent"
      href={href}
    >
      {children}
    </a>
  );
}
