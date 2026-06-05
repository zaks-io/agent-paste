import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { filterCommandItems, groupCommandItems } from "./utils";
import { useCommandItems } from "./use-command-items";
import type { CommandGroupSection, CommandItem } from "./types";

type UseCommandPaletteStateOptions = {
  open: boolean;
  isOperator: boolean;
  close: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

type CommandPaletteState = {
  query: string;
  setQuery: (value: string) => void;
  activeIndex: number;
  setActiveIndex: (updater: (current: number) => number) => void;
  groupedItems: CommandGroupSection[];
  flatItems: CommandItem[];
};

export function useCommandPaletteState({
  open,
  isOperator,
  close,
  inputRef,
  triggerRef,
}: UseCommandPaletteStateOptions): CommandPaletteState {
  const wasOpenRef = useRef(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
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
  }, [inputRef, open]);

  useEffect(() => {
    setActiveIndex((current) => {
      if (flatItems.length === 0) return 0;
      return Math.min(current, flatItems.length - 1);
    });
  }, [flatItems.length]);

  useEffect(() => {
    if (!open && wasOpenRef.current) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open, triggerRef]);

  return { query, setQuery, activeIndex, setActiveIndex, groupedItems, flatItems };
}
