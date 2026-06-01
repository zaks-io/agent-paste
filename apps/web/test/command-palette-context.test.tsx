import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CommandPaletteContext,
  useCommandPaletteContext,
} from "../src/components/chrome/command-palette/command-palette-context";

describe("useCommandPaletteContext", () => {
  it("throws when used outside the provider", () => {
    expect(() => renderHook(() => useCommandPaletteContext())).toThrow(
      "useCommandPaletteContext must be used inside <CommandPaletteProvider>",
    );
  });

  it("returns context values from the provider", () => {
    const value = {
      open: true,
      setOpen: () => {},
      triggerRef: { current: null },
    };

    const { result } = renderHook(() => useCommandPaletteContext(), {
      wrapper: ({ children }) => (
        <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>
      ),
    });

    expect(result.current).toBe(value);
  });
});
