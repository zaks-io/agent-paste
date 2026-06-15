import { describe, expect, it } from "vitest";
import { applyEdits } from "./apply-edits.js";

describe("applyEdits", () => {
  it("replaces a single unique occurrence", () => {
    const result = applyEdits("hello world", [{ oldString: "world", newString: "there" }]);
    expect(result).toEqual({ ok: true, body: "hello there" });
  });

  it("applies edits in order, each seeing the prior result", () => {
    const result = applyEdits("a", [
      { oldString: "a", newString: "b" },
      { oldString: "b", newString: "c" },
    ]);
    expect(result).toEqual({ ok: true, body: "c" });
  });

  it("fails not_found when the oldString does not occur, reporting the edit index", () => {
    const result = applyEdits("hello", [
      { oldString: "hello", newString: "hi" },
      { oldString: "absent", newString: "x" },
    ]);
    expect(result).toEqual({ ok: false, reason: "not_found", index: 1 });
  });

  it("fails not_unique when the oldString occurs more than once without replaceAll", () => {
    const result = applyEdits("x x", [{ oldString: "x", newString: "y" }]);
    expect(result).toEqual({ ok: false, reason: "not_unique", index: 0 });
  });

  it("replaceAll collapses every occurrence literally", () => {
    const result = applyEdits("x x x", [{ oldString: "x", newString: "y", replaceAll: true }]);
    expect(result).toEqual({ ok: true, body: "y y y" });
  });

  it("rejects an empty oldString before any scan", () => {
    const result = applyEdits("hello", [{ oldString: "", newString: "x" }]);
    expect(result).toEqual({ ok: false, reason: "empty_old_string", index: 0 });
  });

  it("matches literally, not as a regex (special chars are not interpreted)", () => {
    const result = applyEdits("price is $1.50 (cash)", [{ oldString: "$1.50 (cash)", newString: "free" }]);
    expect(result).toEqual({ ok: true, body: "price is free" });
  });

  it("does not re-match newString against later edits within the same edit", () => {
    // replaceAll on "a" must not loop forever when newString contains "a".
    const result = applyEdits("aa", [{ oldString: "a", newString: "aa", replaceAll: true }]);
    expect(result).toEqual({ ok: true, body: "aaaa" });
  });

  it("returns the body unchanged for an empty edit list", () => {
    expect(applyEdits("unchanged", [])).toEqual({ ok: true, body: "unchanged" });
  });

  it("treats overlapping occurrences correctly for uniqueness", () => {
    // "aa" occurs twice with overlap in "aaa" only as non-overlapping at index 0; the
    // second search starts past the first match length, so "aaa" has one match of "aa".
    expect(applyEdits("aaa", [{ oldString: "aa", newString: "b" }])).toEqual({ ok: true, body: "ba" });
  });
});
