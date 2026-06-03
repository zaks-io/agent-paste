import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export type BadgeTone = "neutral" | "success" | "warning" | "destructive" | "accent" | "info";

const TEXT: Record<BadgeTone, string> = {
  neutral: "text-[hsl(var(--subtle))]",
  success: "text-[hsl(var(--success))]",
  warning: "text-[hsl(var(--warning))]",
  destructive: "text-[hsl(var(--destructive))]",
  accent: "text-[hsl(var(--accent))]",
  info: "text-[hsl(var(--info))]",
};

const DOT: Record<BadgeTone, string> = {
  neutral: "bg-[hsl(var(--faint))]",
  success: "bg-[hsl(var(--success))]",
  warning: "bg-[hsl(var(--warning))]",
  destructive: "bg-[hsl(var(--destructive))]",
  accent: "bg-[hsl(var(--accent))]",
  info: "bg-[hsl(var(--info))]",
};

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  dot?: boolean;
  /** Pulse the dot — reserved for genuinely live state. */
  pulse?: boolean;
  children: ReactNode;
};

/*
 * Not a pill. A status mark: optional dot + an uppercase mono label on the
 * baseline. Color carries meaning; there is no container chrome.
 */
export function Badge({ tone = "neutral", dot, pulse, className, children, ...rest }: Props) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em]",
        TEXT[tone],
        className,
      )}
      {...rest}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn(
            "h-[6px] w-[6px] rounded-full",
            DOT[tone],
            pulse && "[animation:live-pulse_2.4s_ease-in-out_infinite]",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
