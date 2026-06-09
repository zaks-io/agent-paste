import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../theme-provider";

const ORDER = ["system", "dark", "light"] as const;
const ICON = { system: Monitor, dark: Moon, light: Sun } as const;
const NEXT_LABEL = { system: "dark", dark: "light", light: "system" } as const;

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const Icon = ICON[preference];

  const cycle = () => {
    const i = ORDER.indexOf(preference);
    const next = ORDER[(i + 1) % ORDER.length] ?? "system";
    setPreference(next);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${preference}. Switch to ${NEXT_LABEL[preference]}.`}
      title={`Theme: ${preference}`}
      className="
        grid place-items-center h-8 w-8 rounded-md
        text-muted hover:text-foreground
        hover:bg-surface-raised
        transition-colors duration-150 ease-out
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
      "
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
