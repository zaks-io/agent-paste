import { describe, expect, it, vi } from "vitest";
import { buildActionCommandItems } from "../src/components/chrome/command-palette/command-items-actions";
import { buildNavigationCommandItems } from "../src/components/chrome/command-palette/command-items-navigation";

describe("command item builders", () => {
  describe("buildNavigationCommandItems", () => {
    it("includes standard navigation commands", () => {
      const navigate = vi.fn();
      const items = buildNavigationCommandItems(navigate, false);

      expect(items.map((item) => item.id)).toEqual([
        "dashboard",
        "artifacts",
        "access-links",
        "keys",
        "audit",
        "settings",
        "billing",
        "claim",
      ]);
      expect(items.every((item) => item.group === "navigation")).toBe(true);
    });

    it("adds Admin only for operators", () => {
      const navigate = vi.fn();
      const operatorItems = buildNavigationCommandItems(navigate, true);
      const memberItems = buildNavigationCommandItems(navigate, false);

      expect(operatorItems.map((item) => item.id)).toContain("admin");
      expect(memberItems.map((item) => item.id)).not.toContain("admin");
    });

    it("navigates to the selected route", () => {
      const navigate = vi.fn();
      const items = buildNavigationCommandItems(navigate, false);

      items.find((item) => item.id === "artifacts")?.onSelect();
      expect(navigate).toHaveBeenCalledWith("/artifacts");
    });
  });

  describe("buildActionCommandItems", () => {
    it("includes theme and sign-out actions", () => {
      const setPreference = vi.fn();
      const close = vi.fn();
      const items = buildActionCommandItems(setPreference, close);

      expect(items.map((item) => item.id)).toEqual(["theme-light", "theme-dark", "theme-system", "sign-out"]);
      expect(items.every((item) => item.group === "actions")).toBe(true);
    });

    it("applies theme preferences and closes the palette", () => {
      const setPreference = vi.fn();
      const close = vi.fn();
      const items = buildActionCommandItems(setPreference, close);

      items.find((item) => item.id === "theme-dark")?.onSelect();
      expect(setPreference).toHaveBeenCalledWith("dark");
      expect(close).toHaveBeenCalledOnce();
    });
  });
});
