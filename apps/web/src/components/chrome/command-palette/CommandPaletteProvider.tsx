import { type ReactNode, useEffect, useRef, useState } from "react";
import { CommandPaletteDialog } from "./CommandPaletteDialog";
import { CommandPaletteContext } from "./command-palette-context";

export function CommandPaletteProvider({ children, isOperator }: { children: ReactNode; isOperator: boolean }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setOpen((current) => !current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen, triggerRef }}>
      {children}
      <CommandPaletteDialog open={open} onOpenChange={setOpen} isOperator={isOperator} triggerRef={triggerRef} />
    </CommandPaletteContext.Provider>
  );
}
