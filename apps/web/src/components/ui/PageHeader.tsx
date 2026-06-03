import type { ReactNode } from "react";

type Props = {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, eyebrow, description, meta, actions }: Props) {
  return (
    <header className="mb-10 border-b border-[hsl(var(--rule))] pb-7">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow mb-3">{eyebrow}</p> : null}
          <h1 className="font-display text-[var(--text-display)] font-semibold leading-[0.98] tracking-[-0.025em] text-[hsl(var(--foreground))]">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 max-w-[56ch] text-[14px] leading-relaxed text-[hsl(var(--muted))]">{description}</p>
          ) : null}
          {meta ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-[hsl(var(--subtle))]">
              {meta}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
