import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { truncateId } from "../../lib/format";

type Props = {
  value: string;
  truncate?: boolean;
  className?: string;
  label?: string;
};

export function Identifier({ value, truncate = true, className, label }: Props) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 700);
    } catch {
      // clipboard may be unavailable (no user gesture / insecure context); fail silently
    }
  }, [value]);

  const display = truncate ? truncateId(value) : value;

  return (
    <button
      type="button"
      data-copied={copied ? "true" : undefined}
      onClick={onClick}
      title={value}
      aria-label={label ?? `Copy ${value}`}
      className={cn(
        "font-mono text-[12px] leading-[1.4] cursor-copy",
        "rounded-[var(--radius-xs)] px-[5px] -mx-[5px] py-[1px] -my-[1px]",
        "text-[hsl(var(--subtle))]",
        "transition-[background,color] duration-[120ms] ease-out",
        "hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--foreground))]",
        "data-[copied=true]:text-[hsl(var(--accent))]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--accent))]",
        className,
      )}
      style={{ letterSpacing: "-0.005em" }}
    >
      {display}
    </button>
  );
}
