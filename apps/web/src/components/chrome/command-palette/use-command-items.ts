import { useRouter } from "@tanstack/react-router";
import {
  CreditCard,
  FileStack,
  KeyRound,
  LayoutGrid,
  Link as LinkIcon,
  LogOut,
  Monitor,
  Moon,
  ScrollText,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Sun,
} from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useMemo } from "react";
import { useTheme } from "../../theme-provider";
import type { CommandItem } from "./types";
import { signOut } from "./utils";

type NavDescriptor = {
  id: string;
  label: string;
  keywords: string[];
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  to: string;
  operatorOnly?: boolean;
};

// Pure data: ordered as the human reads them, with /admin gated to operators.
const NAV_ITEMS: ReadonlyArray<NavDescriptor> = [
  { id: "dashboard", label: "Overview", keywords: ["home", "dashboard"], Icon: LayoutGrid, to: "/dashboard" },
  { id: "artifacts", label: "Artifacts", keywords: ["files", "publish"], Icon: FileStack, to: "/artifacts" },
  { id: "access-links", label: "Access Links", keywords: ["links", "share"], Icon: LinkIcon, to: "/access-links" },
  { id: "keys", label: "API Keys", keywords: ["api", "credentials"], Icon: KeyRound, to: "/keys" },
  { id: "audit", label: "Audit Log", keywords: ["events", "history"], Icon: ScrollText, to: "/audit" },
  { id: "settings", label: "Workspace", keywords: ["settings", "workspace"], Icon: SlidersHorizontal, to: "/settings" },
  {
    id: "billing",
    label: "Billing",
    keywords: ["plan", "subscription", "upgrade", "pro", "stripe"],
    Icon: CreditCard,
    to: "/billing",
  },
  {
    id: "claim",
    label: "Claim workspace",
    keywords: ["claim", "ephemeral", "token", "redeem"],
    Icon: Sparkles,
    to: "/claim",
  },
  {
    id: "admin",
    label: "Admin",
    keywords: ["operator", "lockdown"],
    Icon: ShieldAlert,
    to: "/admin",
    operatorOnly: true,
  },
];

export function useCommandItems(isOperator: boolean, close: () => void): CommandItem[] {
  const router = useRouter();
  const { setPreference } = useTheme();

  const navigate = useCallback(
    (to: string) => {
      close();
      void router.navigate({ to });
    },
    [close, router],
  );

  return useMemo(() => {
    const navigation: CommandItem[] = NAV_ITEMS.filter((item) => isOperator || !item.operatorOnly).map((item) => ({
      id: item.id,
      label: item.label,
      keywords: item.keywords,
      Icon: item.Icon,
      group: "navigation",
      onSelect: () => navigate(item.to),
    }));

    const setTheme = (preference: "light" | "dark" | "system") => () => {
      setPreference(preference);
      close();
    };

    const actions: CommandItem[] = [
      {
        id: "theme-light",
        label: "Light theme",
        keywords: ["theme", "appearance", "color"],
        Icon: Sun,
        group: "actions",
        onSelect: setTheme("light"),
      },
      {
        id: "theme-dark",
        label: "Dark theme",
        keywords: ["theme", "appearance", "color"],
        Icon: Moon,
        group: "actions",
        onSelect: setTheme("dark"),
      },
      {
        id: "theme-system",
        label: "System theme",
        keywords: ["theme", "appearance", "color"],
        Icon: Monitor,
        group: "actions",
        onSelect: setTheme("system"),
      },
      {
        id: "sign-out",
        label: "Sign out",
        keywords: ["logout", "exit"],
        Icon: LogOut,
        group: "actions",
        onSelect: () => {
          close();
          signOut();
        },
      },
    ];

    return [...navigation, ...actions];
  }, [close, isOperator, navigate, setPreference]);
}
