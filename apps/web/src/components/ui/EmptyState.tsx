import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Props = {
  title: string;
  body?: ReactNode;
  code?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, body, code, action, className }: Props) {
  return (
    <div className={cn("grid place-items-center text-center mx-auto", "py-20 max-w-[48ch]", className)}>
      <div className="grid gap-4">
        <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.015em]">{title}</h2>
        {body ? <p className="text-[14.5px] text-[hsl(var(--muted))]">{body}</p> : null}
        {code ? (
          <pre
            className={cn(
              "font-mono text-[13px] leading-[1.55] text-left",
              "bg-[hsl(var(--surface-sunken))] border border-[hsl(var(--rule))]",
              "rounded-[var(--radius-sm)] px-5 py-4 overflow-x-auto",
            )}
          >
            <code>{code}</code>
          </pre>
        ) : null}
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </div>
  );
}
