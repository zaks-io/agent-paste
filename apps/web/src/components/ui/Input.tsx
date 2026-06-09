import { cn } from "@agent-paste/ui";
import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";

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
        "h-[35px] w-full px-3 rounded-sm",
        "bg-background text-foreground",
        "border border-rule-strong",
        "placeholder:text-faint",
        "focus:outline-none focus:border-accent",
        "focus:shadow-[0_0_0_3px_hsl(var(--accent)/0.18)]",
        "aria-[invalid=true]:border-destructive",
        "aria-[invalid=true]:focus:shadow-[0_0_0_3px_hsl(var(--destructive)/0.18)]",
        "disabled:opacity-45 disabled:cursor-not-allowed",
        mono ? "font-mono text-mono" : "text-base",
        className,
      )}
      {...rest}
    />
  );
});
