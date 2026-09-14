import { describe, expect, it } from "vitest";
import { ArtifactId, ArtifactReference, PlainTextTitle } from "./primitives.js";

describe("ArtifactReference", () => {
  it("accepts IDs and HTTPS URLs without broadening canonical IDs", () => {
    const id = "art_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const url = "https://dzd5k-mdx2y-6hbn2-ptnh6.agent-paste.link/plan.md?view=1#next";
    expect(ArtifactReference.parse(id)).toBe(id);
    expect(ArtifactReference.parse(url)).toBe(url);
    expect(ArtifactId.safeParse(url).success).toBe(false);
    for (const reference of [
      "dzd5k-mdx2y-6hbn2-ptnh6",
      "DZD5K-MDX2Y-6HBN2-PTNH6",
      "dzd5k-mdx2y-6hbn2-ptnh6-preview",
      "0123456789abcdef0123456789abcdef",
    ]) {
      expect(ArtifactReference.parse(reference)).toBe(reference);
      expect(ArtifactId.safeParse(reference).success).toBe(false);
    }
  });

  it.each([
    "not-an-artifact",
    "http://example.com/",
    "https://user:password@example.com/",
    "https://example.com:444/",
    "file:///tmp/plan.md",
  ])("rejects invalid or unsafe reference syntax %s", (value) => {
    expect(ArtifactReference.safeParse(value).success).toBe(false);
  });
});

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
