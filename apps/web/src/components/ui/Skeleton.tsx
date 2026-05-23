import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "bg-[hsl(var(--rule))] rounded-[var(--radius-sm)]",
        "animate-[skeleton-pulse_1.4s_ease-in-out_infinite]",
        className,
      )}
      {...rest}
    />
  );
}
