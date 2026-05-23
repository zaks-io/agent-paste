import type { ReactNode } from "react";

type Props = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, description, actions }: Props) {
  return (
    <header className="flex flex-col gap-2 mb-8 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.02em]">{title}</h1>
        {description ? <p className="mt-2 text-[13px] text-[hsl(var(--muted))] max-w-prose">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2 sm:mt-1">{actions}</div> : null}
    </header>
  );
}
