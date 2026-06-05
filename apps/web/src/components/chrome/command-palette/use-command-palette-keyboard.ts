import { useEffect, type RefObject } from "react";
import { handleCommandPaletteKeyDown } from "./command-palette-keyboard";
import type { CommandItem } from "./types";

type UseCommandPaletteKeyboardOptions = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeIndex: number;
  setActiveIndex: (updater: (current: number) => number) => void;
  flatItems: CommandItem[];
  dialogRef: RefObject<HTMLDivElement | null>;
};

export function useCommandPaletteKeyboard({
  open,
  onOpenChange,
  activeIndex,
  setActiveIndex,
  flatItems,
  dialogRef,
}: UseCommandPaletteKeyboardOptions): void {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      handleCommandPaletteKeyDown(event, {
        flatItems,
        activeIndex,
        onOpenChange,
        setActiveIndex,
        dialogRef,
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, dialogRef, flatItems, onOpenChange, open, setActiveIndex]);
}
