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

// Every case: generate a diff, then independently apply it and assert the result is
// byte-identical to nextText (the same check the server runs at finalize).
const cases: Array<[name: string, base: string, next: string]> = [
  ["single line change", "hello world\n", "hello there\n"],
  ["insert a line", "a\nb\nc\n", "a\nb\nB2\nc\n"],
  ["delete a line", "a\nb\nc\n", "a\nc\n"],
  [
    "replace middle of many",
    Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n") + "\n",
    Array.from({ length: 50 }, (_, i) => (i === 25 ? "CHANGED" : `line ${i}`)).join("\n") + "\n",
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
    const base = Array.from({ length: 2000 }, (_, i) => `line number ${i} with some padding text`).join("\n") + "\n";
    const next = base.replace("line number 1000 with some padding text", "line number 1000 EDITED");
    const { diffBytes, nextBytes } = await roundTrip(base, next);
    expect(diffBytes).not.toBeNull();
    expect(diffBytes!.byteLength).toBeLessThan(nextBytes.byteLength / 2);
  });
});
