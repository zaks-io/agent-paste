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
        "h-[35px] w-full px-3 rounded-[var(--radius-sm)]",
        "bg-[hsl(var(--background))] text-[hsl(var(--foreground))]",
        "border border-[hsl(var(--rule-strong))]",
        "placeholder:text-[hsl(var(--faint))]",
        "focus:outline-none focus:border-[hsl(var(--accent))]",
        "focus:shadow-[0_0_0_3px_hsl(var(--accent)/0.18)]",
        "aria-[invalid=true]:border-[hsl(var(--destructive))]",
        "aria-[invalid=true]:focus:shadow-[0_0_0_3px_hsl(var(--destructive)/0.18)]",
        "disabled:opacity-45 disabled:cursor-not-allowed",
        mono ? "font-mono text-[12.5px]" : "text-[13.5px]",
        className,
      )}
      {...rest}
    />
  );
});
