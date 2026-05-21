import { describe, expect, it } from "vitest";
import { DEFAULT_ACCESS_LINK_TTL_MS, isExpired, MAX_ARTIFACT_BYTES, normalizeStoragePath } from "./index";

describe("config helpers", () => {
  it("normalizes local storage paths", () => {
    expect(normalizeStoragePath("/workspace\\folder/./file.txt")).toEqual({
      path: "workspace/folder/file.txt",
      segments: ["workspace", "folder", "file.txt"],
    });
  });

  it("rejects unsafe paths", () => {
    expect(() => normalizeStoragePath("../secret")).toThrow("traverse");
    expect(() => normalizeStoragePath("")).toThrow("empty");
  });

  it("exports MVP caps and TTL helpers", () => {
    expect(MAX_ARTIFACT_BYTES).toBeGreaterThan(0);
    expect(DEFAULT_ACCESS_LINK_TTL_MS).toBe(15 * 60 * 1000);
    expect(isExpired("2026-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:00.000Z"))).toBe(true);
  });
});
