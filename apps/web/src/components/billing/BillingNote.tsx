import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tone = "accent" | "warning" | "destructive";

const BORDER: Record<Tone, string> = {
  accent: "border-l-[hsl(var(--accent))]",
  warning: "border-l-[hsl(var(--warning))]",
  destructive: "border-l-[hsl(var(--destructive))]",
};

/**
 * A left-accented hairline note. Not a card — depth comes from the rule + the 2px
 * colored left edge, matching the control-room discipline (no shadows, no fill).
 */
export function BillingNote({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div
      className={cn(
        "mt-[18px] flex items-start gap-3 rounded-[var(--radius-sm)] border border-[hsl(var(--rule))] border-l-2 px-4 py-3",
        "text-[12.5px] leading-relaxed text-[hsl(var(--muted))]",
        "[&_b]:font-medium [&_b]:text-[hsl(var(--foreground))]",
        BORDER[tone],
      )}
    >
      {children}
    </div>
  );
}
