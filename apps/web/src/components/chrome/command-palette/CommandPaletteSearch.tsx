import { Search } from "lucide-react";
import type { RefObject } from "react";

type CommandPaletteSearchProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  listboxId: string;
  activeItemId: string | undefined;
  query: string;
  onQueryChange: (value: string) => void;
};

export function CommandPaletteSearch({
  inputRef,
  listboxId,
  activeItemId,
  query,
  onQueryChange,
}: CommandPaletteSearchProps) {
  return (
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
          onChange={(event) => onQueryChange(event.target.value)}
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
  );
}
