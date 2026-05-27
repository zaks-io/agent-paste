import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export type BadgeTone = "neutral" | "success" | "warning" | "destructive" | "accent" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-[hsl(var(--surface-sunken))] text-[hsl(var(--foreground))] border-[hsl(var(--rule))]",
  success: "text-[hsl(var(--success))] bg-[hsl(var(--success)/0.08)] border-[hsl(var(--success)/0.2)]",
  warning: "text-[hsl(var(--warning))] bg-[hsl(var(--warning)/0.10)] border-[hsl(var(--warning)/0.24)]",
  destructive: "text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)] border-[hsl(var(--destructive)/0.2)]",
  accent: "text-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.08)] border-[hsl(var(--accent)/0.2)]",
  info: "text-[hsl(var(--info))] bg-[hsl(var(--info)/0.08)] border-[hsl(var(--info)/0.2)]",
};

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  children: ReactNode;
};

export function Badge({ tone = "neutral", className, children, ...rest }: Props) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        "text-[11px] leading-none px-[7px] py-[3px]",
        "border rounded-[var(--radius-sm)]",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
