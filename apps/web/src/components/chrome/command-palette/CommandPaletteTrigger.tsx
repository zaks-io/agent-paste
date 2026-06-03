import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useCommandPaletteContext } from "./command-palette-context";

const DEFAULT_SHORTCUT_LABEL = "Ctrl+K";

function getShortcutLabel() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform)
    ? "⌘K"
    : DEFAULT_SHORTCUT_LABEL;
}

export function CommandPaletteTrigger() {
  const { setOpen, triggerRef } = useCommandPaletteContext();
  const [shortcutLabel, setShortcutLabel] = useState(DEFAULT_SHORTCUT_LABEL);

  useEffect(() => {
    setShortcutLabel(getShortcutLabel());
  }, []);

  return (
    <button
      ref={triggerRef}
      type="button"
      aria-label="Open command palette"
      aria-keyshortcuts="Control+K Meta+K"
      onClick={() => setOpen(true)}
      className="
        flex items-center gap-2 h-8 w-full md:min-w-[240px] md:max-w-[320px] px-3
        rounded-[var(--radius-md)] border border-[hsl(var(--rule))]
        bg-[hsl(var(--surface-sunken))] text-[13px] text-[hsl(var(--muted))]
        hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--rule-strong))]
        transition-colors duration-[80ms]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2
      "
    >
      <Search size={14} strokeWidth={1.5} aria-hidden="true" />
      <span className="hidden md:inline flex-1 text-left">Search…</span>
      <span className="md:hidden flex-1 text-left">Search</span>
      <kbd className="hidden md:inline text-[11px] text-[hsl(var(--subtle))] font-medium">{shortcutLabel}</kbd>
    </button>
  );
}
