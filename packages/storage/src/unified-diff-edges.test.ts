import { describe, expect, it } from "vitest";
import { applyUnifiedDiff } from "./unified-diff.js";

const enc = new TextEncoder();

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

async function parseResult(base: string, diff: string) {
  const baseBytes = enc.encode(base);
  return applyUnifiedDiff({
    baseBytes,
    diffBytes: enc.encode(diff),
    expectedBaseSha256: await sha256Hex(baseBytes),
    expectedResultSha256: "0".repeat(64),
  });
}

function numberedBase(lineCount: number) {
  return `${Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`).join("\n")}\n`;
}

describe("applyUnifiedDiff parser edges", () => {
  it("rejects unanchored hunk headers before any real hunk", async () => {
    const out = await parseResult("a\n", "junk @@ -1 +1 @@\n-a\n+b\n");
    expect(out).toEqual({ ok: false, reason: "parse_error" });
  });

  it("rejects unanchored file header words before a real hunk", async () => {
    const out = await parseResult("a\n", "not a diff header\n@@ -1 +1 @@\n-a\n+b\n");
    expect(out).toEqual({ ok: false, reason: "parse_error" });
  });

  it("rejects file header tokens that are not at the start of the line", async () => {
    const out = await parseResult("a\n", "comment --- a/file\n@@ -1 +1 @@\n-a\n+b\n");
    expect(out).toEqual({ ok: false, reason: "parse_error" });
  });

  it("rejects malformed hunk header suffixes", async () => {
    const out = await parseResult("a\n", "@@ -1 +1 @@junk\n-a\n+b\n");
    expect(out).toEqual({ ok: false, reason: "parse_error" });
  });

  it("parses multi-digit hunk line numbers and implicit one-line counts", async () => {
    const base = `${Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n")}\n`;
    const expected = base.replace("line 10\n", "line ten\n");
    const diff = "@@ -10 +10 @@\n-line 10\n+line ten\n";
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(new TextDecoder().decode(out.result)).toBe(expected);
    }
  });

  it("parses multi-digit hunk line numbers and explicit counts", async () => {
    const base = numberedBase(22);
    const expected = base.replace("line 14\n", "line fourteen\n");
    const body = Array.from({ length: 10 }, (_, index) => {
      const lineNumber = index + 10;
      return lineNumber === 14 ? "-line 14\n+line fourteen" : ` line ${lineNumber}`;
    }).join("\n");
    const diff = `@@ -10,10 +10,10 @@\n${body}\n`;
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(new TextDecoder().decode(out.result)).toBe(expected);
    }
  });

  it("rejects hunks whose body counts do not match the header", async () => {
    const out = await parseResult("a\nb\n", "@@ -1,2 +1,2 @@\n-a\n+A\n");
    expect(out).toEqual({ ok: false, reason: "parse_error" });
  });

  it("rejects old-side hunk count mismatches", async () => {
    const out = await parseResult("a\nb\n", "@@ -1,2 +1,1 @@\n-a\n+A\n");
    expect(out).toEqual({ ok: false, reason: "parse_error" });
  });

  it("rejects new-side hunk count mismatches", async () => {
    const out = await parseResult("a\n", "@@ -1,1 +1,2 @@\n-a\n+A\n");
    expect(out).toEqual({ ok: false, reason: "parse_error" });
  });

  it("rejects file headers with no hunk body", async () => {
    const out = await parseResult("a\n", "--- a/file\n+++ b/file\n");
    expect(out).toEqual({ ok: false, reason: "parse_error" });
  });

  it("rejects hunk starts past the end of the base", async () => {
    const out = await parseResult("a\n", "@@ -3,0 +3,1 @@\n+late\n");
    expect(out).toEqual({ ok: false, reason: "apply_failed" });
  });

  it("rejects context lines that only share a prefix with the base line", async () => {
    const out = await parseResult("abc\n", "@@ -1,1 +1,1 @@\n abcd\n");
    expect(out).toEqual({ ok: false, reason: "apply_failed" });
  });

  it("treats a bare empty diff body line as empty context", async () => {
    const base = "top\n\nbottom\n";
    const diff = "@@ -1,3 +1,3 @@\n top\n\n-bottom\n+BOTTOM\n";
    const expected = "top\n\nBOTTOM\n";
    const out = await applyText(base, diff, expected);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(new TextDecoder().decode(out.result)).toBe(expected);
    }
  });
});
