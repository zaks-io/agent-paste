import { cn } from "@agent-paste/ui";
import type { ReactNode } from "react";

export type RailItem = {
  label: string;
  value: ReactNode;
  tone?: "default" | "accent" | "warning";
};

type Props = {
  /** Tiny uppercase mono label above the figure. */
  eyebrow: string;
  /** The headline figure — the eye's anchor, but inline, not full-bleed. */
  value: ReactNode;
  /** What the figure counts — sits beside it. */
  caption: ReactNode;
  /** Sub-caption: context line in muted mono. */
  detail?: ReactNode;
  /** Supporting numbers as a thin mono rail on the same baseline. */
  rail?: ReadonlyArray<RailItem>;
};

const RAIL_TONE = {
  default: "text-foreground",
  accent: "text-accent",
  warning: "text-warning",
} as const;

/*
 * Compact status strip. The figure is the anchor and stays characterful, but it
 * sits INLINE with its caption and the supporting rail on one row — it does not
 * eat the fold. Content below stays high on the page.
 */
export function HeroStat({ eyebrow, value, caption, detail, rail }: Props) {
  return (
    <section className="flex flex-col gap-8 border-b border-rule pb-8 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
      <div className="flex items-end gap-5">
        <span className="hero-figure text-foreground">{value}</span>
        <div className="pb-2">
          <p className="eyebrow mb-2">{eyebrow}</p>
          <p className="font-display text-h2 font-semibold leading-none tracking-tight">{caption}</p>
          {detail ? <p className="mt-2 font-mono text-xs text-subtle">{detail}</p> : null}
        </div>
      </div>

      {rail && rail.length > 0 ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-4 lg:justify-end">
          {rail.map((item) => (
            <div key={item.label} className="grid gap-2">
              <dt className="eyebrow">{item.label}</dt>
              <dd
                className={cn(
                  "font-mono text-h2 font-medium tabular-nums leading-none",
                  RAIL_TONE[item.tone ?? "default"],
                )}
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
