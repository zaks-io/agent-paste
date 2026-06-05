import type { RefObject } from "react";
import type { CommandItem } from "./types";
import { getFocusableElements } from "./utils";

type PaletteKeyContext = {
  flatItems: CommandItem[];
  activeIndex: number;
  onOpenChange: (open: boolean) => void;
  setActiveIndex: (updater: (current: number) => number) => void;
  dialogRef: RefObject<HTMLDivElement | null>;
};

function handleEscape(event: KeyboardEvent, onOpenChange: (open: boolean) => void): void {
  event.preventDefault();
  onOpenChange(false);
}

function handleArrowDown(event: KeyboardEvent, flatItems: CommandItem[], setActiveIndex: PaletteKeyContext["setActiveIndex"]): void {
  event.preventDefault();
  setActiveIndex((current) => (flatItems.length === 0 ? 0 : (current + 1) % flatItems.length));
}

function handleArrowUp(event: KeyboardEvent, flatItems: CommandItem[], setActiveIndex: PaletteKeyContext["setActiveIndex"]): void {
  event.preventDefault();
  setActiveIndex((current) => (flatItems.length === 0 ? 0 : (current - 1 + flatItems.length) % flatItems.length));
}

function handleEnter(event: KeyboardEvent, flatItems: CommandItem[], activeIndex: number): void {
  const item = flatItems[activeIndex];
  if (!item) return;
  event.preventDefault();
  item.onSelect();
}

function handleTabTrap(event: KeyboardEvent, dialogRef: RefObject<HTMLDivElement | null>): void {
  if (!dialogRef.current) return;

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
}

export function handleCommandPaletteKeyDown(event: KeyboardEvent, ctx: PaletteKeyContext): void {
  if (event.key === "Escape") {
    handleEscape(event, ctx.onOpenChange);
    return;
  }

  if (event.key === "ArrowDown") {
    handleArrowDown(event, ctx.flatItems, ctx.setActiveIndex);
    return;
  }

  if (event.key === "ArrowUp") {
    handleArrowUp(event, ctx.flatItems, ctx.setActiveIndex);
    return;
  }

  if (event.key === "Enter") {
    handleEnter(event, ctx.flatItems, ctx.activeIndex);
    return;
  }

  if (event.key === "Tab") {
    handleTabTrap(event, ctx.dialogRef);
  }
}
