import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  mono?: boolean;
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, Props>(function Input({ className, mono, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "h-[34px] px-3 w-full",
        "bg-[hsl(var(--surface))] text-[hsl(var(--foreground))]",
        "border border-[hsl(var(--rule))] rounded-[var(--radius-sm)]",
        "placeholder:text-[hsl(var(--subtle))]",
        "focus:outline-none focus:border-[hsl(var(--accent))]",
        "focus:shadow-[0_0_0_3px_hsl(var(--accent)/0.12)]",
        "aria-[invalid=true]:border-[hsl(var(--destructive))]",
        "aria-[invalid=true]:focus:shadow-[0_0_0_3px_hsl(var(--destructive)/0.12)]",
        "disabled:opacity-45 disabled:cursor-not-allowed",
        mono ? "font-mono text-[13px]" : "text-[14px]",
        className,
      )}
      {...rest}
    />
  );
});
