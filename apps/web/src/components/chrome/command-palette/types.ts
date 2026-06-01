import type { ComponentType, RefObject } from "react";

export type CommandGroup = "navigation" | "actions";

export type CommandItem = {
  id: string;
  label: string;
  keywords: string[];
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  group: CommandGroup;
  onSelect: () => void;
};

export type CommandPaletteContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

export type CommandPaletteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOperator: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

export type CommandGroupSection = {
  group: CommandGroup;
  label: string;
  items: CommandItem[];
};
