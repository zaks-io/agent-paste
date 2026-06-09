import { CommandPaletteOption } from "./CommandPaletteOption";
import type { CommandGroupSection, CommandItem } from "./types";

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
    return <p className="px-2 py-6 text-center text-sm text-muted">No matching commands.</p>;
  }

  return (
    <div id={listboxId} role="listbox" aria-label="Commands" className="grid gap-3">
      {groupedItems.map(({ group, label, items: groupItems }) => (
        <div key={group} className="grid gap-1">
          <p className="px-2 py-1 text-mono-sm uppercase tracking-wide text-subtle font-semibold">{label}</p>
          <ul className="grid gap-1">
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
