import type { CommandGroupSection, CommandItem } from "./types";
import { CommandPaletteOption } from "./CommandPaletteOption";

type CommandPaletteResultsProps = {
  listboxId: string;
  groupedItems: CommandGroupSection[];
  flatItems: CommandItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
};

export function CommandPaletteResults({
  listboxId,
  groupedItems,
  flatItems,
  activeIndex,
  onActiveIndexChange,
}: CommandPaletteResultsProps) {
  if (flatItems.length === 0) {
    return <p className="px-2 py-6 text-center text-[13px] text-[hsl(var(--muted))]">No matching commands.</p>;
  }

  return (
    <div id={listboxId} role="listbox" aria-label="Commands" className="grid gap-3">
      {groupedItems.map(({ group, label, items: groupItems }) => (
        <div key={group} className="grid gap-0.5">
          <p className="px-2 py-1 text-[11px] uppercase tracking-[0.04em] text-[hsl(var(--subtle))] font-semibold">
            {label}
          </p>
          <ul className="grid gap-0.5">
            {groupItems.map((item) => {
              const index = flatItems.indexOf(item);
              return (
                <CommandPaletteOption
                  key={item.id}
                  item={item}
                  listboxId={listboxId}
                  selected={index === activeIndex}
                  onHover={() => onActiveIndexChange(index)}
                  onSelect={() => item.onSelect()}
                />
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
