import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** Focal region: a hairline turns to the accent and the surface lifts one ladder step. */
  elevated?: boolean;
  /** No inner padding — for regions that own their own row padding. */
  flush?: boolean;
};

/*
 * Not a card. A hairline-bordered region on the surface ladder. Square corners,
 * no drop shadow. Depth comes from the ladder + rules, never elevation tricks.
 */
export function Card({ className, children, elevated, flush, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-md",
        elevated ? "border border-accent/35 bg-surface" : "border border-rule bg-surface",
        flush ? "p-0" : "p-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
        {subtitle ? <p className="mt-1 text-mono text-subtle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </div>
  );
}

/** A ruled section header: uppercase mono label, then a hairline spanning the row. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="eyebrow shrink-0">{children}</span>
      <span aria-hidden className="h-px flex-1 bg-rule" />
    </div>
  );
}
