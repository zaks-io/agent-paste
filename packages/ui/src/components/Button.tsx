import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "destructive" | "link";
export type ButtonSize = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

const BASE =
  "inline-flex items-center justify-center gap-2 font-medium select-none rounded-[var(--radius-sm)] " +
  "transition-[background-color,color,border-color] duration-150 ease-[var(--ease-out)] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] " +
  "disabled:opacity-45 disabled:cursor-not-allowed";

const VARIANTS: Record<ButtonVariant, string> = {
  // Primary IS the accent — one voltage, one job.
  primary: "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--accent-dim))]",
  accent: "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--accent-dim))]",
  secondary:
    "bg-transparent text-[hsl(var(--foreground))] border border-[hsl(var(--rule-strong))] " +
    "hover:bg-[hsl(var(--surface-2))] hover:border-[hsl(var(--rule-strong))]",
  ghost: "bg-transparent text-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-2))]",
  destructive: "bg-[hsl(var(--destructive))] text-[hsl(var(--fg-0))] hover:opacity-90",
  link: "bg-transparent text-[hsl(var(--accent))] underline-offset-4 hover:underline px-0 py-0 h-auto rounded-none",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-[30px] px-[12px] text-[12.5px]",
  md: "h-[35px] px-[15px] text-[13.5px]",
  lg: "h-[40px] px-[18px] text-[14px]",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = "primary", size = "md", loading, children, disabled, type, ...rest },
  ref,
) {
  const isLink = variant === "link";
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(BASE, VARIANTS[variant], !isLink && SIZES[size], className)}
      disabled={disabled || loading}
      data-loading={loading ? "true" : undefined}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {loading ? (
        <>
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
          />
          <span className="sr-only">Loading</span>
        </>
      ) : (
        children
      )}
    </button>
  );
});
