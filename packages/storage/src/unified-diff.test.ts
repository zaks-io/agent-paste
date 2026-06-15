import { describe, expect, it } from "vitest";
import { applyUnifiedDiff, decodeUtf8Strict } from "./unified-diff.js";

const enc = new TextEncoder();

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Apply a real unified-diff body against a base string and assert the result is
// byte-identical to the expected result, with hashes verified by the applier.
async function applyText(base: string, diff: string, expectedResult: string) {
  const baseBytes = enc.encode(base);
  const resultBytes = enc.encode(expectedResult);
  return applyUnifiedDiff({
    baseBytes,
    diffBytes: enc.encode(diff),
    expectedBaseSha256: await sha256Hex(baseBytes),
    expectedResultSha256: await sha256Hex(resultBytes),
  });
}

describe("decodeUtf8Strict", () => {
  it("preserves a leading UTF-8 BOM so valid BOM text is not rejected as binary", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode("hello\n")]);
    const decoded = decodeUtf8Strict(bytes);
    expect(decoded).not.toBeNull();
    expect(enc.encode(decoded as string)).toEqual(bytes);
  });

  it("returns null for invalid UTF-8", () => {
    expect(decodeUtf8Strict(new Uint8Array([0xff, 0xfe, 0x00]))).toBeNull();
  });
});

describe("applyUnifiedDiff", () => {
  it("applies a single-hunk modification + append byte-exactly", async () => {
    const base = "line1\nline2\nline3\n";
    const diff = "@@ -1,3 +1,4 @@\n line1\n-line2\n+line2 modified\n line3\n+line4 added\n";
    const expected = "line1\nline2 modified\nline3\nline4 added\n";
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(new TextDecoder().decode(out.result)).toBe(expected);
    }
  });

  it("applies multiple hunks", async () => {
    const base = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";
    // Change b->B in hunk 1 and i->I in hunk 2.
    const diff = "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -8,3 +8,3 @@\n h\n-i\n+I\n j\n";
    const expected = "a\nB\nc\nd\ne\nf\ng\nh\nI\nj\n";
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(new TextDecoder().decode(out.result)).toBe(expected);
    }
  });

  it("handles a header preamble (---/+++) before the first hunk", async () => {
    const base = "x\ny\n";
    const diff = "--- a/file\n+++ b/file\n@@ -1,2 +1,2 @@\n x\n-y\n+Y\n";
    const expected = "x\nY\n";
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
  });

  it("preserves CRLF line endings byte-exactly", async () => {
    const base = "one\r\ntwo\r\nthree\r\n";
    const diff = "@@ -1,3 +1,3 @@\n one\r\n-two\r\n+TWO\r\n three\r\n";
    const expected = "one\r\nTWO\r\nthree\r\n";
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect([...out.result]).toEqual([...enc.encode(expected)]);
    }
  });

  it("preserves a leading BOM and non-ASCII bytes in unchanged regions", async () => {
    const base = "﻿héllo\nwörld\n";
    const diff = "@@ -1,2 +1,2 @@\n ﻿héllo\n-wörld\n+wörld!\n";
    const expected = "﻿héllo\nwörld!\n";
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect([...out.result]).toEqual([...enc.encode(expected)]);
    }
  });

  it("honors no-newline-at-eof on the added last line", async () => {
    const base = "a\nb\n";
    const diff = "@@ -1,2 +1,3 @@\n a\n b\n+c\n\\ No newline at end of file\n";
    const expected = "a\nb\nc";
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(new TextDecoder().decode(out.result)).toBe(expected);
      expect(out.result.at(-1)).not.toBe(0x0a);
    }
  });

  it("handles base-no-newline becoming result-with-newline", async () => {
    const base = "x\ny";
    const diff = "@@ -1,2 +1,2 @@\n x\n-y\n\\ No newline at end of file\n+y\n";
    const expected = "x\ny\n";
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(new TextDecoder().decode(out.result)).toBe(expected);
    }
  });

  it("modifies a last line that had no trailing newline", async () => {
    const base = "alpha\nbeta\ngamma";
    const diff = "@@ -1,3 +1,3 @@\n alpha\n-beta\n+BETA\n gamma\n\\ No newline at end of file\n";
    const expected = "alpha\nBETA\ngamma";
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(new TextDecoder().decode(out.result)).toBe(expected);
    }
  });

  it("applies an insert into an empty base", async () => {
    const base = "";
    const diff = "@@ -0,0 +1,2 @@\n+hello\n+world\n";
    const expected = "hello\nworld\n";
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(new TextDecoder().decode(out.result)).toBe(expected);
    }
  });

  it("deletes lines", async () => {
    const base = "keep1\ndrop\nkeep2\n";
    const diff = "@@ -1,3 +1,2 @@\n keep1\n-drop\n keep2\n";
    const expected = "keep1\nkeep2\n";
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
  });

  it("applies a real multi-hunk git diff with section headings after @@", async () => {
    const base = [
      "function greet(name) {",
      '  console.log("Hello, " + name);',
      "}",
      "",
      "function farewell(name) {",
      '  console.log("Bye, " + name);',
      "}",
      "",
      'greet("world");',
      "",
    ].join("\n");
    const expected = [
      "function greet(name) {",
      "  console.log(`Hello, ${name}!`);",
      "}",
      "",
      "function farewell(name) {",
      '  console.log("Bye, " + name);',
      "}",
      "",
      'greet("world");',
      'farewell("world");',
      "",
    ].join("\n");
    // Verbatim `git diff --no-index -U3` body, including the " function farewell(name) {"
    // section heading appended after the second hunk's closing @@.
    const diff =
      "@@ -1,5 +1,5 @@\n" +
      " function greet(name) {\n" +
      '-  console.log("Hello, " + name);\n' +
      "+  console.log(`Hello, ${name}!`);\n" +
      " }\n" +
      " \n" +
      " function farewell(name) {\n" +
      "@@ -7,3 +7,4 @@ function farewell(name) {\n" +
      " }\n" +
      " \n" +
      ' greet("world");\n' +
      '+farewell("world");\n';
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(new TextDecoder().decode(out.result)).toBe(expected);
    }
  });

  describe("conflicts", () => {
    it("reports base_hash_mismatch when the base digest is wrong", async () => {
      const out = await applyUnifiedDiff({
        baseBytes: enc.encode("actual base\n"),
        diffBytes: enc.encode("@@ -1 +1 @@\n-x\n+y\n"),
        expectedBaseSha256: "0".repeat(64),
        expectedResultSha256: "0".repeat(64),
      });
      expect(out).toEqual({ ok: false, reason: "base_hash_mismatch" });
    });

    it("reports parse_error on malformed diff text", async () => {
      const base = "a\n";
      const baseBytes = enc.encode(base);
      const out = await applyUnifiedDiff({
        baseBytes,
        diffBytes: enc.encode("this is not a diff at all\n"),
        expectedBaseSha256: await sha256Hex(baseBytes),
        expectedResultSha256: "0".repeat(64),
      });
      expect(out).toEqual({ ok: false, reason: "parse_error" });
    });

    it("reports parse_error on non-UTF-8 diff bytes", async () => {
      const base = "a\n";
      const baseBytes = enc.encode(base);
      const out = await applyUnifiedDiff({
        baseBytes,
        diffBytes: new Uint8Array([0xff, 0xfe, 0x00]),
        expectedBaseSha256: await sha256Hex(baseBytes),
        expectedResultSha256: "0".repeat(64),
      });
      expect(out).toEqual({ ok: false, reason: "parse_error" });
    });

    it("reports apply_failed when context does not match the base", async () => {
      const base = "a\nb\nc\n";
      const baseBytes = enc.encode(base);
      // Context claims "X" where the base has "a".
      const out = await applyUnifiedDiff({
        baseBytes,
        diffBytes: enc.encode("@@ -1,3 +1,3 @@\n X\n-b\n+B\n c\n"),
        expectedBaseSha256: await sha256Hex(baseBytes),
        expectedResultSha256: "0".repeat(64),
      });
      expect(out).toEqual({ ok: false, reason: "apply_failed" });
    });

    it("reports apply_failed on out-of-order / overlapping hunks", async () => {
      const base = "a\nb\nc\nd\n";
      const baseBytes = enc.encode(base);
      // Second hunk targets line 1, before the first hunk's line 3.
      const out = await applyUnifiedDiff({
        baseBytes,
        diffBytes: enc.encode("@@ -3,1 +3,1 @@\n-c\n+C\n@@ -1,1 +1,1 @@\n-a\n+A\n"),
        expectedBaseSha256: await sha256Hex(baseBytes),
        expectedResultSha256: "0".repeat(64),
      });
      expect(out).toEqual({ ok: false, reason: "apply_failed" });
    });

    it("reports result_hash_mismatch when the applied bytes do not match the declared result", async () => {
      const base = "a\nb\n";
      const baseBytes = enc.encode(base);
      const out = await applyUnifiedDiff({
        baseBytes,
        diffBytes: enc.encode("@@ -1,2 +1,2 @@\n a\n-b\n+B\n"),
        expectedBaseSha256: await sha256Hex(baseBytes),
        // Correct applied result is "a\nB\n"; declare a different digest.
        expectedResultSha256: "1".repeat(64),
      });
      expect(out).toEqual({ ok: false, reason: "result_hash_mismatch" });
    });
  });
});
