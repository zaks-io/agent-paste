import { cn } from "@agent-paste/ui";
import type { ReactNode } from "react";

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
        "mx-auto grid max-w-[56ch] place-items-center border border-rule px-8 py-20 text-center",
        "rounded-md bg-surface",
        className,
      )}
    >
      <div className="grid gap-5">
        {icon ? (
          <div className="mx-auto grid h-11 w-11 place-items-center border border-rule text-subtle rounded-sm">
            {icon}
          </div>
        ) : null}
        <h2 className="font-display text-h2 font-semibold leading-tight tracking-tighter text-foreground">{title}</h2>
        {body ? <p className="text-base leading-relaxed text-muted">{body}</p> : null}
        {code ? (
          <pre
            className={cn(
              "mt-1 overflow-x-auto border border-rule bg-background text-left rounded-sm",
              "px-5 py-4 font-mono text-mono leading-loose text-foreground",
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
