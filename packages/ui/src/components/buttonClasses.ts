import { cn } from "../lib/cn";

/**
 * The single source for the button look. Both <Button> (a real <button>) and
 * <ButtonAnchor> (an <a> that must look like a button) compose these, so a CTA
 * rendered as a link cannot drift from one rendered as a button. Change the look
 * here once and every call site in both apps updates.
 */
export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "destructive" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 font-medium select-none rounded-sm whitespace-nowrap " +
  "transition-[background-color,color,border-color] duration-150 ease-out " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "disabled:opacity-45 disabled:cursor-not-allowed";

const VARIANTS: Record<ButtonVariant, string> = {
  // Primary IS the accent — one voltage, one job.
  primary: "bg-accent text-accent-foreground hover:bg-accent-dim",
  accent: "bg-accent text-accent-foreground hover:bg-accent-dim",
  secondary: "bg-transparent text-foreground border border-rule-strong hover:bg-surface-2 hover:border-rule-strong",
  ghost: "bg-transparent text-muted hover:text-foreground hover:bg-surface-2",
  destructive: "bg-destructive text-accent-foreground hover:opacity-90",
  link: "bg-transparent text-accent underline-offset-4 hover:underline px-0 py-0 h-auto rounded-none",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-[30px] px-3 text-mono",
  md: "h-[35px] px-4 text-base",
  lg: "h-[40px] px-4 text-base",
};

/** Compose the button look for a given variant/size, merging caller overrides last. */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  const isLink = variant === "link";
  return cn(BASE, VARIANTS[variant], !isLink && SIZES[size], className);
}
