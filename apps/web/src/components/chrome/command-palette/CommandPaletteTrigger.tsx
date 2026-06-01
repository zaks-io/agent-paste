import { Search } from "lucide-react";
import { useCommandPaletteContext } from "./command-palette-context";

export function CommandPaletteTrigger() {
  const { setOpen, triggerRef } = useCommandPaletteContext();
  const shortcutLabel =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘K" : "Ctrl+K";

  return (
    <button
      ref={triggerRef}
      type="button"
      aria-label="Open command palette"
      aria-keyshortcuts={shortcutLabel}
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
