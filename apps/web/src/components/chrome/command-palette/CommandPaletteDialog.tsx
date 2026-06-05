import { useCallback, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { CommandPaletteDialogProps } from "./types";
import { CommandPaletteDialogView } from "./CommandPaletteDialogView";
import { useCommandPaletteKeyboard } from "./use-command-palette-keyboard";
import { useCommandPaletteState } from "./use-command-palette-state";

export function CommandPaletteDialog({ open, onOpenChange, isOperator, triggerRef }: CommandPaletteDialogProps) {
  const titleId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const { query, setQuery, activeIndex, setActiveIndex, groupedItems, flatItems } = useCommandPaletteState({
    open,
    isOperator,
    close,
    inputRef,
    triggerRef,
  });

  useCommandPaletteKeyboard({
    open,
    onOpenChange,
    activeIndex,
    setActiveIndex,
    flatItems,
    dialogRef,
  });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <CommandPaletteDialogView
      titleId={titleId}
      listboxId={listboxId}
      dialogRef={dialogRef}
      inputRef={inputRef}
      query={query}
      onQueryChange={setQuery}
      onClose={close}
      groupedItems={groupedItems}
      flatItems={flatItems}
      activeIndex={activeIndex}
      onActiveIndexChange={(index) => setActiveIndex(() => index)}
    />,
    document.body,
  );
}
