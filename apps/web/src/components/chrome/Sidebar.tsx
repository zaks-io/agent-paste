import { Link } from "@tanstack/react-router";
import { FileStack, Gauge, KeyRound, Link as LinkIcon, ScrollText, ShieldAlert, Sparkles } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "../../lib/cn";

type Item = {
  to: string;
  label: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>;
};

const ITEMS: ReadonlyArray<Item> = [
  { to: "/artifacts", label: "Artifacts", Icon: FileStack },
  { to: "/claim", label: "Claim", Icon: Sparkles },
  { to: "/access-links", label: "Access Links", Icon: LinkIcon },
  { to: "/keys", label: "API Keys", Icon: KeyRound },
  { to: "/audit", label: "Audit Log", Icon: ScrollText },
  { to: "/settings", label: "Workspace", Icon: Gauge },
];

export function Sidebar({ isOperator }: { isOperator: boolean }) {
  return (
    <aside className="w-[240px] shrink-0 hidden lg:block border-r border-[hsl(var(--rule))]">
      <nav className="p-2 grid gap-0.5">
        {ITEMS.map(({ to, label, Icon }) => (
          <SidebarLink key={to} to={to} label={label} Icon={Icon} />
        ))}
        {isOperator ? (
          <>
            <div
              className="
                px-2 pt-4 pb-1 text-[11px] uppercase tracking-[0.04em]
                text-[hsl(var(--subtle))] font-semibold
              "
            >
              Operator
            </div>
            <SidebarLink to="/admin" label="Admin" Icon={ShieldAlert} />
          </>
        ) : null}
      </nav>
    </aside>
  );
}

function SidebarLink({ to, label, Icon }: Item) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: false }}
      className={cn(
        "flex items-center gap-[10px] h-[30px] px-2 rounded-[var(--radius-sm)]",
        "text-[13px] text-[hsl(var(--foreground))]",
        "hover:bg-[hsl(var(--surface-sunken))] transition-colors duration-[80ms]",
      )}
      activeProps={{
        className: "bg-[hsl(var(--surface-sunken))]",
        "aria-current": "page",
      }}
    >
      <Icon size={16} strokeWidth={1.5} />
      <span>{label}</span>
    </Link>
  );
}
