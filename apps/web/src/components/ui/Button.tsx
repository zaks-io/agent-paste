import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "link";
export type ButtonSize = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

const BASE =
  "inline-flex items-center justify-center gap-2 font-medium select-none " +
  "transition-colors duration-[80ms] ease-[var(--ease-out)] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-[hsl(var(--accent))] " +
  "disabled:opacity-45 disabled:cursor-not-allowed";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[hsl(var(--primary))] text-[hsl(var(--primary-fg))] " +
    "hover:bg-[hsl(var(--primary)/0.9)] active:bg-[hsl(var(--primary)/0.85)] " +
    "rounded-[var(--radius-md)]",
  secondary:
    "bg-[hsl(var(--surface))] text-[hsl(var(--foreground))] " +
    "border border-[hsl(var(--rule))] hover:bg-[hsl(var(--surface-sunken))] " +
    "rounded-[var(--radius-md)]",
  ghost:
    "bg-transparent text-[hsl(var(--foreground))] " +
    "hover:bg-[hsl(var(--surface-sunken))] rounded-[var(--radius-md)]",
  destructive:
    "bg-[hsl(var(--destructive))] text-[hsl(var(--neutral-50))] " +
    "hover:bg-[hsl(var(--destructive)/0.9)] rounded-[var(--radius-md)]",
  link: "bg-transparent text-[hsl(var(--accent))] underline-offset-4 " + "hover:underline px-0 py-0 h-auto",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-[28px] px-[10px] text-[13px]",
  md: "h-[34px] px-[14px] text-[14px]",
  lg: "h-[40px] px-[18px] text-[15px]",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = "primary", size = "md", loading, children, disabled, ...rest },
  ref,
) {
  const isLink = variant === "link";
  return (
    <button
      ref={ref}
      className={cn(BASE, VARIANTS[variant], !isLink && SIZES[size], className)}
      disabled={disabled || loading}
      data-loading={loading ? "true" : undefined}
      {...rest}
    >
      {loading ? (
        <span aria-hidden className="opacity-50">
          ···
        </span>
      ) : (
        children
      )}
    </button>
  );
});
