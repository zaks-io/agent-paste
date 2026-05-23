import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-separate border-spacing-0 tabular-nums text-[14px]", className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return (
    <tbody
      className={cn("[&_tr:hover]:bg-[hsl(var(--surface-sunken))] [&_tr]:transition-colors", "[&_tr]:duration-[80ms]")}
    >
      {children}
    </tbody>
  );
}

export function TR({ children, className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn(className)} {...rest}>
      {children}
    </tr>
  );
}

export function TH({ className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "text-left font-semibold uppercase tracking-[0.04em] text-[11px] leading-[1.3]",
        "text-[hsl(var(--muted))] px-4 py-3 border-b border-[hsl(var(--rule-strong))]",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TD({ className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-4 py-3 border-b border-[hsl(var(--rule))] last:[tr:last-child_&]:border-0", className)}
      {...rest}
    >
      {children}
    </td>
  );
}
