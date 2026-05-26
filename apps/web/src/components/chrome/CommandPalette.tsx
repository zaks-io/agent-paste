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
  Search,
  ShieldAlert,
  Sun,
  X,
} from "lucide-react";
import {
  type ComponentType,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { useTheme } from "../theme-provider";

type CommandGroup = "navigation" | "actions";

type CommandItem = {
  id: string;
  label: string;
  keywords: string[];
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  group: CommandGroup;
  onSelect: () => void;
};

type CommandPaletteContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
};

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

function useCommandPaletteContext(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPaletteContext must be used inside <CommandPaletteProvider>");
  return ctx;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function matchesQuery(item: CommandItem, query: string): boolean {
  if (!query) return true;
  const haystack = [item.label, ...item.keywords].map(normalize).join(" ");
  return haystack.includes(query);
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getAttribute("aria-hidden") !== "true");
}

function signOut(): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/api/auth/sign-out";
  document.body.appendChild(form);
  form.submit();
}

function useCommandItems(isOperator: boolean, close: () => void): CommandItem[] {
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

function CommandPaletteDialog({ open, onOpenChange, isOperator, triggerRef }: CommandPaletteDialogProps) {
  const titleId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const items = useCommandItems(isOperator, close);

  const filteredItems = useMemo(() => {
    const normalized = normalize(query);
    return items.filter((item) => matchesQuery(item, normalized));
  }, [items, query]);

  const groupedItems = useMemo(() => {
    const groups: Array<{ group: CommandGroup; label: string; items: CommandItem[] }> = [
      { group: "navigation", label: "Navigation", items: [] },
      { group: "actions", label: "Actions", items: [] },
    ];
    for (const item of filteredItems) {
      const bucket = groups.find((entry) => entry.group === item.group);
      bucket?.items.push(item);
    }
    return groups.filter((entry) => entry.items.length > 0);
  }, [filteredItems]);

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

type CommandPaletteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOperator: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
};

export function CommandPaletteProvider({ children, isOperator }: { children: ReactNode; isOperator: boolean }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setOpen((current) => !current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen, triggerRef }}>
      {children}
      <CommandPaletteDialog open={open} onOpenChange={setOpen} isOperator={isOperator} triggerRef={triggerRef} />
    </CommandPaletteContext.Provider>
  );
}

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
