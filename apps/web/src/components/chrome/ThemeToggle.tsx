import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "../../lib/cn";
import { useTheme } from "../theme-provider";

const OPTIONS = [
  { value: "light", Icon: Sun, label: "Light theme" },
  { value: "system", Icon: Monitor, label: "System theme" },
  { value: "dark", Icon: Moon, label: "Dark theme" },
] as const;

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <fieldset
      aria-label="Color theme"
      className="inline-flex items-center gap-0.5 p-0.5 border border-[hsl(var(--rule))] rounded-[var(--radius-md)]"
    >
      {OPTIONS.map(({ value, Icon, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={preference === value}
          aria-label={label}
          onClick={() => setPreference(value)}
          className={cn(
            "size-7 grid place-items-center rounded-[4px] transition-colors duration-[80ms]",
            preference === value
              ? "bg-[hsl(var(--surface-sunken))] text-[hsl(var(--foreground))]"
              : "text-[hsl(var(--muted))] hover:bg-[hsl(var(--surface-sunken))]",
          )}
        >
          <Icon size={14} strokeWidth={1.5} />
        </button>
      ))}
    </fieldset>
  );
}
