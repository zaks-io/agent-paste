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
        "font-mono text-xs leading-normal cursor-copy",
        "rounded-xs px-1 -mx-1 py-px -my-px",
        "text-subtle",
        "transition-[background,color] duration-[120ms] ease-out",
        "hover:bg-accent-tint hover:text-foreground",
        "data-[copied=true]:text-accent",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
        className,
      )}
      style={{ letterSpacing: "-0.005em" }}
    >
      {display}
    </button>
  );
}
