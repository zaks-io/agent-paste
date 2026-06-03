import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Props = {
  title: string;
  body?: ReactNode;
  code?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
};

export function EmptyState({ title, body, code, action, icon, className }: Props) {
  return (
    <div
      className={cn(
        "mx-auto grid max-w-[56ch] place-items-center border border-[hsl(var(--rule))] px-8 py-20 text-center",
        "rounded-[var(--radius-md)] bg-[hsl(var(--surface))]",
        className,
      )}
    >
      <div className="grid gap-5">
        {icon ? (
          <div className="mx-auto grid h-11 w-11 place-items-center border border-[hsl(var(--rule))] text-[hsl(var(--subtle))] rounded-[var(--radius-sm)]">
            {icon}
          </div>
        ) : null}
        <h2 className="font-display text-[24px] font-semibold leading-tight tracking-[-0.015em] text-[hsl(var(--foreground))]">
          {title}
        </h2>
        {body ? <p className="text-[14px] leading-relaxed text-[hsl(var(--muted))]">{body}</p> : null}
        {code ? (
          <pre
            className={cn(
              "mt-1 overflow-x-auto border border-[hsl(var(--rule))] bg-[hsl(var(--background))] text-left rounded-[var(--radius-sm)]",
              "px-5 py-4 font-mono text-[12.5px] leading-[1.7] text-[hsl(var(--foreground))]",
            )}
          >
            <code>{code}</code>
          </pre>
        ) : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}
