import { createHash } from "node:crypto";
import { applyUnifiedDiff } from "@agent-paste/storage";
import { describe, expect, it } from "vitest";
import { diffWithSelfCheck } from "./unified-diff-gen.js";

function sha(text: string): string {
  return createHash("sha256").update(new TextEncoder().encode(text)).digest("hex");
}

async function roundTrip(baseText: string, nextText: string) {
  const nextBytes = new TextEncoder().encode(nextText);
  const diffBytes = await diffWithSelfCheck({
    baseText,
    baseSha256: sha(baseText),
    nextText,
    nextBytes,
    expectedResultSha256: sha(nextText),
  });
  return { diffBytes, nextBytes };
}

async function diffText(baseText: string, nextText: string): Promise<string> {
  const { diffBytes } = await roundTrip(baseText, nextText);
  expect(diffBytes).not.toBeNull();
  return new TextDecoder().decode(diffBytes);
}

function paddedLine(index: number): string {
  return `line ${String(index).padStart(2, "0")} -- ${"x".repeat(24)}`;
}

// Every case: generate a diff, then independently apply it and assert the result is
// byte-identical to nextText (the same check the server runs at finalize).
const cases: Array<[name: string, base: string, next: string]> = [
  ["single line change", "hello world\n", "hello there\n"],
  ["insert a line", "a\nb\nc\n", "a\nb\nB2\nc\n"],
  ["delete a line", "a\nb\nc\n", "a\nc\n"],
  [
    "replace middle of many",
    `${Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n")}\n`,
    `${Array.from({ length: 50 }, (_, i) => (i === 25 ? "CHANGED" : `line ${i}`)).join("\n")}\n`,
  ],
  ["CRLF preserved", "a\r\nb\r\nc\r\n", "a\r\nB\r\nc\r\n"],
  ["BOM + non-ascii", "﻿# Tïtle\ncafé\n", "﻿# Tïtle\ncafé au lait\n"],
  ["no trailing newline (base) -> newline", "a\nb", "a\nb\n"],
  ["trailing newline -> no trailing newline", "a\nb\n", "a\nb"],
  ["both no trailing newline", "a\nb", "a\nB"],
  ["append without trailing newline", "a\n", "a\nb"],
  ["empty base -> content", "", "new line\n"],
  ["multibyte astral", "a\n😀\nb\n", "a\n😀🎉\nb\n"],
];

describe("diffWithSelfCheck", () => {
  for (const [name, base, next] of cases) {
    it(`round-trips: ${name}`, async () => {
      const { diffBytes } = await roundTrip(base, next);
      // Some cases produce a diff not smaller than the file (tiny files): then null
      // is correct (caller whole-blobs). When a diff IS produced it must reconstruct.
      if (diffBytes === null) {
        return;
      }
      const applied = await applyUnifiedDiff({
        baseBytes: new TextEncoder().encode(base),
        diffBytes,
        expectedBaseSha256: sha(base),
        expectedResultSha256: sha(next),
      });
      expect(applied.ok).toBe(true);
      if (applied.ok) {
        expect(new TextDecoder().decode(applied.result)).toBe(next);
      }
    });
  }

  it("returns null for an unchanged file (no empty diff is ever emitted)", async () => {
    const { diffBytes } = await roundTrip("same\n", "same\n");
    expect(diffBytes).toBeNull();
  });

  it("returns null when the diff is not smaller than the new file", async () => {
    // A total rewrite of a tiny file: the diff carries both sides, so it is larger.
    const { diffBytes } = await roundTrip("x\n", "completely different content here\n");
    expect(diffBytes).toBeNull();
  });

  it("produces a real saving on a large file with a one-line edit", async () => {
    const base = `${Array.from({ length: 2000 }, (_, i) => `line number ${i} with some padding text`).join("\n")}\n`;
    const next = base.replace("line number 1000 with some padding text", "line number 1000 EDITED");
    const { diffBytes, nextBytes } = await roundTrip(base, next);
    if (diffBytes === null) {
      throw new Error("Expected diff bytes for a sparse large-file edit");
    }
    expect(diffBytes.byteLength).toBeLessThan(nextBytes.byteLength / 2);
  });

  it("emits an exact middle-line replacement hunk", async () => {
    const baseLines = Array.from({ length: 20 }, (_, index) => paddedLine(index));
    const nextLines = baseLines.map((line, index) => (index === 10 ? "line 10 -- EDITED value" : line));

    await expect(diffText(`${baseLines.join("\n")}\n`, `${nextLines.join("\n")}\n`)).resolves.toBe(`@@ -8,7 +8,7 @@
 line 07 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 08 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 09 -- xxxxxxxxxxxxxxxxxxxxxxxx
-line 10 -- xxxxxxxxxxxxxxxxxxxxxxxx
+line 10 -- EDITED value
 line 11 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 12 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 13 -- xxxxxxxxxxxxxxxxxxxxxxxx
`);
  });

  it("anchors a first-line replacement at line one", async () => {
    const baseLines = Array.from({ length: 20 }, (_, index) => paddedLine(index));
    const nextLines = baseLines.map((line, index) => (index === 0 ? "line 00 -- EDITED value" : line));

    await expect(diffText(`${baseLines.join("\n")}\n`, `${nextLines.join("\n")}\n`)).resolves.toBe(`@@ -1,4 +1,4 @@
-line 00 -- xxxxxxxxxxxxxxxxxxxxxxxx
+line 00 -- EDITED value
 line 01 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 02 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 03 -- xxxxxxxxxxxxxxxxxxxxxxxx
`);
  });

  it("emits no-newline markers for an unterminated replaced tail", async () => {
    const baseLines = Array.from({ length: 20 }, (_, index) => paddedLine(index));
    const nextLines = baseLines.map((line, index) => (index === 19 ? "line 19 -- EDITED tail" : line));

    await expect(diffText(baseLines.join("\n"), nextLines.join("\n"))).resolves.toBe(`@@ -17,4 +17,4 @@
 line 16 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 17 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 18 -- xxxxxxxxxxxxxxxxxxxxxxxx
-line 19 -- xxxxxxxxxxxxxxxxxxxxxxxx
\\ No newline at end of file
+line 19 -- EDITED tail
\\ No newline at end of file
`);
  });

  it("splits distant changes into separate hunks", async () => {
    const baseLines = Array.from({ length: 30 }, (_, index) => paddedLine(index));
    const nextLines = baseLines.map((line, index) => {
      if (index === 5) return "line 05 -- EDITED A";
      if (index === 20) return "line 20 -- EDITED B";
      return line;
    });

    await expect(diffText(`${baseLines.join("\n")}\n`, `${nextLines.join("\n")}\n`)).resolves.toBe(`@@ -3,7 +3,7 @@
 line 02 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 03 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 04 -- xxxxxxxxxxxxxxxxxxxxxxxx
-line 05 -- xxxxxxxxxxxxxxxxxxxxxxxx
+line 05 -- EDITED A
 line 06 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 07 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 08 -- xxxxxxxxxxxxxxxxxxxxxxxx
@@ -18,7 +18,7 @@
 line 17 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 18 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 19 -- xxxxxxxxxxxxxxxxxxxxxxxx
-line 20 -- xxxxxxxxxxxxxxxxxxxxxxxx
+line 20 -- EDITED B
 line 21 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 22 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 23 -- xxxxxxxxxxxxxxxxxxxxxxxx
`);
  });

  it("merges changes separated by the context boundary", async () => {
    const baseLines = Array.from({ length: 30 }, (_, index) => paddedLine(index));
    const nextLines = baseLines.map((line, index) => {
      if (index === 5) return "line 05 -- EDITED A";
      if (index === 12) return "line 12 -- EDITED B";
      return line;
    });

    await expect(diffText(`${baseLines.join("\n")}\n`, `${nextLines.join("\n")}\n`)).resolves.toBe(`@@ -3,14 +3,14 @@
 line 02 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 03 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 04 -- xxxxxxxxxxxxxxxxxxxxxxxx
-line 05 -- xxxxxxxxxxxxxxxxxxxxxxxx
+line 05 -- EDITED A
 line 06 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 07 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 08 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 09 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 10 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 11 -- xxxxxxxxxxxxxxxxxxxxxxxx
-line 12 -- xxxxxxxxxxxxxxxxxxxxxxxx
+line 12 -- EDITED B
 line 13 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 14 -- xxxxxxxxxxxxxxxxxxxxxxxx
 line 15 -- xxxxxxxxxxxxxxxxxxxxxxxx
`);
  });

  it("returns null instead of building an oversized LCS table", async () => {
    const baseLines = Array.from({ length: 3000 }, (_, index) => `line ${index}`);
    const nextLines = baseLines.map((line, index) => (index === 1500 ? "line 1500 edited" : line));
    const { diffBytes } = await roundTrip(`${baseLines.join("\n")}\n`, `${nextLines.join("\n")}\n`);
    expect(diffBytes).toBeNull();
  });
});
