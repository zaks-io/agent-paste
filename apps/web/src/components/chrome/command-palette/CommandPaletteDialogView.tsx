import { X } from "lucide-react";
import type { RefObject } from "react";
import { CommandPaletteResults } from "./CommandPaletteResults";
import { CommandPaletteSearch } from "./CommandPaletteSearch";
import type { CommandGroupSection, CommandItem } from "./types";

type CommandPaletteDialogViewProps = {
  titleId: string;
  listboxId: string;
  dialogRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  groupedItems: CommandGroupSection[];
  flatItems: CommandItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
};

export function CommandPaletteDialogView({
  titleId,
  listboxId,
  dialogRef,
  inputRef,
  query,
  onQueryChange,
  onClose,
  groupedItems,
  flatItems,
  activeIndex,
  onActiveIndexChange,
}: CommandPaletteDialogViewProps) {
  const activeItemId = flatItems[activeIndex] ? `${listboxId}-option-${flatItems[activeIndex].id}` : undefined;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close command palette"
        className="
          absolute inset-0 bg-neutral-900/45
          dark:bg-[hsl(0_0%_0%/0.65)]
          motion-safe:animate-[fade-in_140ms_var(--ease-out)_both]
        "
        onClick={onClose}
      />
      <div className="absolute inset-0 grid place-items-start md:place-items-center p-4 pt-[12vh] pointer-events-none">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="
            pointer-events-auto w-full max-w-[560px]
            rounded-md border border-rule
            bg-surface shadow-[var(--shadow-overlay)]
            motion-safe:animate-[modal-in_160ms_var(--ease-out)_both]
          "
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-rule">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">
              Command palette
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="
                size-7 grid place-items-center rounded-sm
                text-muted hover:bg-surface-sunken hover:text-foreground
                transition-colors duration-[80ms]
              "
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>

          <CommandPaletteSearch
            inputRef={inputRef}
            listboxId={listboxId}
            activeItemId={activeItemId}
            query={query}
            onQueryChange={onQueryChange}
          />

          <div className="max-h-[min(360px,50vh)] overflow-y-auto p-2">
            <CommandPaletteResults
              listboxId={listboxId}
              groupedItems={groupedItems}
              flatItems={flatItems}
              activeIndex={activeIndex}
              onActiveIndexChange={onActiveIndexChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
