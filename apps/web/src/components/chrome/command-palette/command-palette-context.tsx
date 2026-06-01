import { createContext, useContext } from "react";
import type { CommandPaletteContextValue } from "./types";

export const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPaletteContext(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPaletteContext must be used inside <CommandPaletteProvider>");
  return ctx;
}
