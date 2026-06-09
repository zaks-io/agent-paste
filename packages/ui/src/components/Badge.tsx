import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export type BadgeTone = "neutral" | "success" | "warning" | "destructive" | "accent" | "info";

const TEXT: Record<BadgeTone, string> = {
  neutral: "text-subtle",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  accent: "text-accent",
  info: "text-info",
};

const DOT: Record<BadgeTone, string> = {
  neutral: "bg-faint",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  accent: "bg-accent",
  info: "bg-info",
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
        "inline-flex items-center gap-2 font-mono text-meta font-medium uppercase tracking-wider",
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
