import { cn } from "@agent-paste/ui";
import type { ReactNode } from "react";

type Tone = "accent" | "warning" | "destructive";

const BORDER: Record<Tone, string> = {
  accent: "border-l-accent",
  warning: "border-l-warning",
  destructive: "border-l-destructive",
};

/**
 * A left-accented hairline note. Not a card — depth comes from the rule + the 2px
 * colored left edge, matching the control-room discipline (no shadows, no fill).
 */
export function BillingNote({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div
      className={cn(
        "mt-4 flex items-start gap-3 rounded-sm border border-rule border-l-2 px-4 py-3",
        "text-mono leading-relaxed text-muted",
        "[&_b]:font-medium [&_b]:text-foreground",
        BORDER[tone],
      )}
    >
      {children}
    </div>
  );
}
