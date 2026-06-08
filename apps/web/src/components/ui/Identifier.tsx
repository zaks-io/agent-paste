import { cn } from "@agent-paste/ui";
import { truncateId } from "../../lib/format";
import { useClipboardCopy } from "../../lib/use-clipboard-copy";

type Props = {
  value: string;
  truncate?: boolean;
  className?: string;
  label?: string;
};

export function Identifier({ value, truncate = true, className, label }: Props) {
  const { copied, copy: onClick } = useClipboardCopy(value);

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
