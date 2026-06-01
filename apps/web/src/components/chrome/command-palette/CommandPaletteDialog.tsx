import { Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../../lib/cn";
import type { CommandPaletteDialogProps } from "./types";
import { useCommandItems } from "./use-command-items";
import { filterCommandItems, getFocusableElements, groupCommandItems } from "./utils";

export function CommandPaletteDialog({ open, onOpenChange, isOperator, triggerRef }: CommandPaletteDialogProps) {
  const titleId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const items = useCommandItems(isOperator, close);

  const filteredItems = useMemo(() => filterCommandItems(items, query), [items, query]);

  const groupedItems = useMemo(() => groupCommandItems(filteredItems), [filteredItems]);

  const flatItems = useMemo(() => groupedItems.flatMap((entry) => entry.items), [groupedItems]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) => {
      if (flatItems.length === 0) return 0;
      return Math.min(current, flatItems.length - 1);
    });
  }, [flatItems.length]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (flatItems.length === 0 ? 0 : (current + 1) % flatItems.length));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (flatItems.length === 0 ? 0 : (current - 1 + flatItems.length) % flatItems.length));
        return;
      }

      if (event.key === "Enter" && flatItems[activeIndex]) {
        event.preventDefault();
        flatItems[activeIndex].onSelect();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = getFocusableElements(dialogRef.current);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, flatItems, onOpenChange, open]);

  useEffect(() => {
    if (!open && wasOpenRef.current) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open, triggerRef]);

  if (!open || typeof document === "undefined") return null;

  const activeItemId = flatItems[activeIndex] ? `${listboxId}-option-${flatItems[activeIndex].id}` : undefined;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close command palette"
        className="
          absolute inset-0 bg-[hsl(var(--neutral-900)/0.45)]
          dark:bg-[hsl(0_0%_0%/0.65)]
          motion-safe:animate-[fade-in_140ms_var(--ease-out)_both]
        "
        onClick={() => onOpenChange(false)}
      />
      <div className="absolute inset-0 grid place-items-start md:place-items-center p-4 pt-[12vh] pointer-events-none">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="
            pointer-events-auto w-full max-w-[560px]
            rounded-[var(--radius-lg)] border border-[hsl(var(--rule))]
            bg-[hsl(var(--surface))] shadow-[var(--shadow-overlay)]
            motion-safe:animate-[modal-in_160ms_var(--ease-out)_both]
          "
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[hsl(var(--rule))]">
            <h2 id={titleId} className="text-[16px] font-semibold tracking-[-0.005em]">
              Command palette
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
              className="
                size-7 grid place-items-center rounded-[var(--radius-sm)]
                text-[hsl(var(--muted))] hover:bg-[hsl(var(--surface-sunken))] hover:text-[hsl(var(--foreground))]
                transition-colors duration-[80ms]
              "
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>

          <div className="px-4 py-3 border-b border-[hsl(var(--rule))]">
            <div className="relative">
              <Search
                size={16}
                strokeWidth={1.5}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted))]"
                aria-hidden="true"
              />
              <input
                ref={inputRef}
                type="search"
                role="combobox"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={activeItemId}
                aria-label="Search commands"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search commands…"
                className="
                  w-full h-9 pl-9 pr-3 rounded-[var(--radius-sm)]
                  border border-[hsl(var(--rule))] bg-[hsl(var(--surface-sunken))]
                  text-[13px] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--subtle))]
                  outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2
                "
              />
            </div>
          </div>

          <div className="max-h-[min(360px,50vh)] overflow-y-auto p-2">
            {flatItems.length === 0 ? (
              <p className="px-2 py-6 text-center text-[13px] text-[hsl(var(--muted))]">No matching commands.</p>
            ) : (
              <div id={listboxId} role="listbox" aria-label="Commands" className="grid gap-3">
                {groupedItems.map(({ group, label, items: groupItems }) => (
                  <div key={group} className="grid gap-0.5">
                    <p className="px-2 py-1 text-[11px] uppercase tracking-[0.04em] text-[hsl(var(--subtle))] font-semibold">
                      {label}
                    </p>
                    <ul className="grid gap-0.5">
                      {groupItems.map((item) => {
                        const index = flatItems.indexOf(item);
                        const selected = index === activeIndex;
                        return (
                          <li key={item.id} role="presentation">
                            <button
                              id={`${listboxId}-option-${item.id}`}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onMouseEnter={() => setActiveIndex(index)}
                              onClick={() => item.onSelect()}
                              className={cn(
                                "w-full flex items-center gap-[10px] h-[34px] px-2 rounded-[var(--radius-sm)]",
                                "text-[13px] text-[hsl(var(--foreground))] text-left",
                                "transition-colors duration-[80ms]",
                                selected
                                  ? "bg-[hsl(var(--surface-sunken))] outline-none ring-2 ring-[hsl(var(--accent))] ring-offset-2 ring-offset-[hsl(var(--surface))]"
                                  : "hover:bg-[hsl(var(--surface-sunken))]",
                              )}
                            >
                              <item.Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                              <span>{item.label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
