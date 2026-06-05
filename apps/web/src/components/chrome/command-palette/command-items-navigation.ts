import {
  CreditCard,
  FileStack,
  KeyRound,
  LayoutGrid,
  Link as LinkIcon,
  ScrollText,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import type { CommandItem } from "./types";

export type NavigateCommand = (to: string) => void;

type NavigationRoute = {
  id: string;
  label: string;
  keywords: string[];
  route: string;
  Icon: CommandItem["Icon"];
};

const NAVIGATION_ROUTES: NavigationRoute[] = [
  {
    id: "dashboard",
    label: "Overview",
    keywords: ["home", "dashboard"],
    route: "/dashboard",
    Icon: LayoutGrid,
  },
  {
    id: "artifacts",
    label: "Artifacts",
    keywords: ["files", "publish"],
    route: "/artifacts",
    Icon: FileStack,
  },
  {
    id: "access-links",
    label: "Access Links",
    keywords: ["links", "share"],
    route: "/access-links",
    Icon: LinkIcon,
  },
  {
    id: "keys",
    label: "API Keys",
    keywords: ["api", "credentials"],
    route: "/keys",
    Icon: KeyRound,
  },
  {
    id: "audit",
    label: "Audit Log",
    keywords: ["events", "history"],
    route: "/audit",
    Icon: ScrollText,
  },
  {
    id: "settings",
    label: "Workspace",
    keywords: ["settings", "workspace"],
    route: "/settings",
    Icon: SlidersHorizontal,
  },
  {
    id: "billing",
    label: "Billing",
    keywords: ["plan", "subscription", "upgrade", "pro", "stripe"],
    route: "/billing",
    Icon: CreditCard,
  },
  {
    id: "claim",
    label: "Claim workspace",
    keywords: ["claim", "ephemeral", "token", "redeem"],
    route: "/claim",
    Icon: Sparkles,
  },
];

const OPERATOR_ROUTE: NavigationRoute = {
  id: "admin",
  label: "Admin",
  keywords: ["operator", "lockdown"],
  route: "/admin",
  Icon: ShieldAlert,
};

function toNavigationItem(route: NavigationRoute, navigate: NavigateCommand): CommandItem {
  return {
    id: route.id,
    label: route.label,
    keywords: route.keywords,
    Icon: route.Icon,
    group: "navigation",
    onSelect: () => navigate(route.route),
  };
}

export function buildNavigationCommandItems(navigate: NavigateCommand, isOperator: boolean): CommandItem[] {
  const routes = isOperator ? [...NAVIGATION_ROUTES, OPERATOR_ROUTE] : NAVIGATION_ROUTES;
  return routes.map((route) => toNavigationItem(route, navigate));
}
