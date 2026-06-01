import { describe, expect, it } from "vitest";
import type { CommandItem } from "../src/components/chrome/command-palette/types";
import {
  filterCommandItems,
  groupCommandItems,
  matchesQuery,
  normalize,
} from "../src/components/chrome/command-palette/utils";

function item(overrides: Partial<CommandItem> & Pick<CommandItem, "id" | "label">): CommandItem {
  return {
    keywords: [],
    Icon: () => null,
    group: "navigation",
    onSelect: () => {},
    ...overrides,
  };
}

describe("command palette utils", () => {
  describe("normalize", () => {
    it("trims and lowercases values", () => {
      expect(normalize("  Audit Log  ")).toBe("audit log");
    });
  });

  describe("matchesQuery", () => {
    const audit = item({
      id: "audit",
      label: "Audit Log",
      keywords: ["events", "history"],
    });

    it("matches empty queries", () => {
      expect(matchesQuery(audit, "")).toBe(true);
    });

    it("matches label and keyword substrings", () => {
      expect(matchesQuery(audit, "audit")).toBe(true);
      expect(matchesQuery(audit, "events")).toBe(true);
      expect(matchesQuery(audit, "artifacts")).toBe(false);
    });
  });

  describe("filterCommandItems", () => {
    const items = [
      item({ id: "dashboard", label: "Dashboard", keywords: ["home"] }),
      item({ id: "audit", label: "Audit Log", keywords: ["events"] }),
    ];

    it("returns all items for an empty query", () => {
      expect(filterCommandItems(items, "")).toHaveLength(2);
    });

    it("filters by normalized query", () => {
      expect(filterCommandItems(items, "  AUDIT ")).toEqual([items[1]]);
    });
  });

  describe("groupCommandItems", () => {
    it("groups items and drops empty sections", () => {
      const grouped = groupCommandItems([
        item({ id: "dashboard", label: "Dashboard", group: "navigation" }),
        item({ id: "sign-out", label: "Sign out", group: "actions" }),
      ]);

      expect(grouped).toEqual([
        { group: "navigation", label: "Navigation", items: [expect.objectContaining({ id: "dashboard" })] },
        { group: "actions", label: "Actions", items: [expect.objectContaining({ id: "sign-out" })] },
      ]);
    });

    it("omits groups with no matching items", () => {
      const grouped = groupCommandItems([item({ id: "dashboard", label: "Dashboard", group: "navigation" })]);
      expect(grouped).toHaveLength(1);
      expect(grouped[0]?.group).toBe("navigation");
    });
  });
});
