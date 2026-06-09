import { cn } from "@agent-paste/ui";
import { Link } from "@tanstack/react-router";
import {
  CreditCard,
  FileStack,
  KeyRound,
  LayoutGrid,
  Link as LinkIcon,
  ScrollText,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import type { ComponentType } from "react";

type Item = {
  to: string;
  label: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  exact?: boolean;
};

type Section = {
  heading?: string;
  items: ReadonlyArray<Item>;
};

/*
 * Ordered by where the human's eye should land: the daily glance first,
 * then the work, then the plumbing they configure once. Claim is a funnel
 * action, not a standing destination — it lives in empty states, not here.
 */
const SECTIONS: ReadonlyArray<Section> = [
  {
    items: [
      { to: "/dashboard", label: "Overview", Icon: LayoutGrid, exact: true },
      { to: "/artifacts", label: "Artifacts", Icon: FileStack },
      { to: "/access-links", label: "Access Links", Icon: LinkIcon },
    ],
  },
  {
    heading: "Configuration",
    items: [
      { to: "/keys", label: "API Keys", Icon: KeyRound },
      { to: "/audit", label: "Audit Log", Icon: ScrollText },
      { to: "/settings", label: "Workspace", Icon: SlidersHorizontal },
      { to: "/billing", label: "Billing", Icon: CreditCard },
    ],
  },
];

export function Sidebar({ isOperator }: { isOperator: boolean }) {
  return (
    <aside
      className="
        w-[244px] shrink-0 hidden lg:block
        border-r border-rule
        bg-background
      "
    >
      <nav className="px-3 py-4 grid gap-5 sticky top-[57px]">
        {SECTIONS.map((section, i) => (
          <SidebarSection key={section.heading ?? `s-${i}`} section={section} />
        ))}
        {isOperator ? (
          <SidebarSection
            section={{
              heading: "Operator",
              items: [{ to: "/admin", label: "Admin", Icon: ShieldAlert }],
            }}
          />
        ) : null}
      </nav>
    </aside>
  );
}

function SidebarSection({ section }: { section: Section }) {
  return (
    <div className="grid gap-1">
      {section.heading ? <SectionLabel>{section.heading}</SectionLabel> : null}
      {section.items.map((item) => (
        <SidebarLink key={item.to} {...item} />
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <div className="eyebrow px-3 pb-2 pt-1">{children}</div>;
}

function SidebarLink({ to, label, Icon, exact }: Item) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: exact ?? false }}
      className={cn(
        "group relative flex items-center gap-3 h-[33px] pl-4 pr-3",
        "rounded-sm text-sm text-muted",
        "transition-colors duration-150 ease-out",
        "hover:text-foreground hover:bg-surface-2",
      )}
      activeProps={{
        className: cn(
          "text-foreground bg-surface-2 font-medium",
          // Active rail: a square vermilion bar pinned to the left edge.
          "before:absolute before:left-0 before:top-[6px] before:bottom-[6px]",
          "before:w-[2px] before:bg-accent",
        ),
        "aria-current": "page",
      }}
    >
      <Icon size={15} strokeWidth={1.75} />
      <span>{label}</span>
    </Link>
  );
}
