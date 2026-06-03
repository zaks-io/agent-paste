import type { ReactNode } from "react";

type Props = {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
};

/*
 * A tight page-title row, not a banner. Eyebrow + title sit on one baseline with
 * any actions; the rule below separates it from content without pushing the page
 * down. Hierarchy on inner pages comes from this restraint — the content leads,
 * the header just names the place.
 */
export function PageHeader({ title, eyebrow, description, meta, actions }: Props) {
  return (
    <header className="mb-8 border-b border-[hsl(var(--rule))] pb-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="font-display text-[26px] font-semibold leading-none tracking-[-0.02em] text-[hsl(var(--foreground))]">
            {title}
          </h1>
          {eyebrow ? <span className="eyebrow shrink-0">{eyebrow}</span> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
      {description ? (
        <p className="mt-3 max-w-[64ch] text-[13.5px] leading-relaxed text-[hsl(var(--muted))]">{description}</p>
      ) : null}
      {meta ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-[hsl(var(--subtle))]">
          {meta}
        </div>
      ) : null}
    </header>
  );
}
