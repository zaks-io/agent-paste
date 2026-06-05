import { cn } from "../../../lib/cn";
import type { CommandItem } from "./types";

type CommandPaletteOptionProps = {
  item: CommandItem;
  listboxId: string;
  selected: boolean;
  onHover: () => void;
  onSelect: () => void;
};

export function CommandPaletteOption({ item, listboxId, selected, onHover, onSelect }: CommandPaletteOptionProps) {
  return (
    <li role="presentation">
      <button
        id={`${listboxId}-option-${item.id}`}
        type="button"
        role="option"
        aria-selected={selected}
        onMouseEnter={onHover}
        onClick={onSelect}
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
}
