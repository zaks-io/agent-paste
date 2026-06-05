import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import type { CommandItem } from "./types";
import { signOut } from "./utils";

export type ThemePreference = "light" | "dark" | "system";
export type SetThemePreference = (preference: ThemePreference) => void;

export function buildActionCommandItems(setPreference: SetThemePreference, close: () => void): CommandItem[] {
  return [
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
}
