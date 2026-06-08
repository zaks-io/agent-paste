import { cn } from "@agent-paste/ui";
import type { ReactNode } from "react";

export type Stat = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
};

/*
 * A ledger row of secondary figures: hairline-divided columns, mono tabular
 * values, square. Never the page's focal point — the hero figure is.
 */
export function StatBand({ stats, className }: { stats: ReadonlyArray<Stat>; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 border-y border-[hsl(var(--rule))] sm:grid-cols-4", className)}>
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className={cn("flex flex-col gap-1.5 py-5 pr-6", i > 0 && "sm:border-l sm:border-[hsl(var(--rule))] sm:pl-6")}
        >
          <span className="eyebrow">{stat.label}</span>
          <span
            className={cn(
              "font-mono text-[26px] font-medium tabular-nums leading-none",
              stat.accent ? "text-[hsl(var(--accent))]" : "text-[hsl(var(--foreground))]",
            )}
          >
            {stat.value}
          </span>
          {stat.hint ? <span className="font-mono text-[11px] text-[hsl(var(--subtle))]">{stat.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}
