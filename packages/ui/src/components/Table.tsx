import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-separate border-spacing-0 text-base", className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="[&_tr]:transition-colors [&_tr:hover]:bg-surface-2">{children}</tbody>;
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
        "border-b border-rule px-4 py-2 text-left",
        "font-mono text-meta font-medium uppercase tracking-eyebrow text-subtle",
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
      className={cn("border-b border-rule px-4 py-3 text-foreground", "[tr:last-child_&]:border-0", className)}
      {...rest}
    >
      {children}
    </td>
  );
}
