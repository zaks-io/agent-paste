import { describe, expect, it } from "vitest";
import { PlainTextTitle } from "./primitives.js";

describe("PlainTextTitle", () => {
  it("rejects terminal control characters", () => {
    for (const title of ["forged\noutput", "ansi\u001b[31mred", "delete\u007fkey", "csi\u009b31mred"]) {
      expect(PlainTextTitle.safeParse(title).success).toBe(false);
    }
  });

  it("accepts ordinary Unicode text", () => {
    expect(PlainTextTitle.parse("Quarterly report: café")).toBe("Quarterly report: café");
  });
});
