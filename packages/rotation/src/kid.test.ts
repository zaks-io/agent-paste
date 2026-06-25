import { describe, expect, it } from "vitest";
import { parseKidLabel } from "./kid.js";

describe("parseKidLabel", () => {
  it("accepts v-prefixed and plain positive integers", () => {
    expect(parseKidLabel("v1", 9)).toBe(1);
    expect(parseKidLabel("v2", 9)).toBe(2);
    expect(parseKidLabel("2", 9)).toBe(2);
    expect(parseKidLabel("10", 9)).toBe(10);
    expect(parseKidLabel(" V10 ", 9)).toBe(10);
  });

  it("rejects v0, partial numerics, and invalid labels", () => {
    expect(parseKidLabel("v0", 1)).toBe(1);
    expect(parseKidLabel("0", 1)).toBe(1);
    expect(parseKidLabel("2foo", 1)).toBe(1);
    expect(parseKidLabel("foo2", 1)).toBe(1);
    expect(parseKidLabel("v2beta", 1)).toBe(1);
    expect(parseKidLabel("xv2", 1)).toBe(1);
    expect(parseKidLabel(undefined, 3)).toBe(3);
  });
});
