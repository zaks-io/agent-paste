import { useRouter } from "@tanstack/react-router";
import {
  FileStack,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Link as LinkIcon,
  LogOut,
  Monitor,
  Moon,
  ScrollText,
  ShieldAlert,
  Sun,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { useTheme } from "../../theme-provider";
import type { CommandItem } from "./types";
import { signOut } from "./utils";

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
    const navigation: CommandItem[] = [
      {
        id: "dashboard",
        label: "Dashboard",
        keywords: ["home", "overview"],
        Icon: LayoutDashboard,
        group: "navigation",
        onSelect: () => navigate("/dashboard"),
      },
      {
        id: "artifacts",
        label: "Artifacts",
        keywords: ["files", "publish"],
        Icon: FileStack,
        group: "navigation",
        onSelect: () => navigate("/artifacts"),
      },
      {
        id: "access-links",
        label: "Access Links",
        keywords: ["links", "share"],
        Icon: LinkIcon,
        group: "navigation",
        onSelect: () => navigate("/access-links"),
      },
      {
        id: "keys",
        label: "API Keys",
        keywords: ["api", "credentials"],
        Icon: KeyRound,
        group: "navigation",
        onSelect: () => navigate("/keys"),
      },
      {
        id: "audit",
        label: "Audit Log",
        keywords: ["events", "history"],
        Icon: ScrollText,
        group: "navigation",
        onSelect: () => navigate("/audit"),
      },
      {
        id: "settings",
        label: "Workspace",
        keywords: ["settings", "workspace"],
        Icon: Gauge,
        group: "navigation",
        onSelect: () => navigate("/settings"),
      },
    ];

    if (isOperator) {
      navigation.push({
        id: "admin",
        label: "Admin",
        keywords: ["operator", "lockdown"],
        Icon: ShieldAlert,
        group: "navigation",
        onSelect: () => navigate("/admin"),
      });
    }

    const actions: CommandItem[] = [
      {
        id: "theme-light",
        label: "Light theme",
        keywords: ["theme", "appearance", "color"],
        Icon: Sun,
        group: "actions",
        onSelect: () => {
          setPreference("light");
          close();
        },
      },
      {
        id: "theme-dark",
        label: "Dark theme",
        keywords: ["theme", "appearance", "color"],
        Icon: Moon,
        group: "actions",
        onSelect: () => {
          setPreference("dark");
          close();
        },
      },
      {
        id: "theme-system",
        label: "System theme",
        keywords: ["theme", "appearance", "color"],
        Icon: Monitor,
        group: "actions",
        onSelect: () => {
          setPreference("system");
          close();
        },
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
