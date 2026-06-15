import { applyUnifiedDiff } from "@agent-paste/storage";

// Byte-exact unified-diff generator for the CLI patch-revise path (ADR 0090).
// It must produce output the storage applier (`applyUnifiedDiff`) reconstructs
// to the exact result bytes, so it NEVER normalizes line endings, BOM, or trailing
// newlines: lines split on raw LF (0x0a) only, a trailing CR stays in the line
// content, and a final line without a newline emits the "\ No newline" marker.
//
// The generator is best-effort, not minimal — `diffWithSelfCheck` applies the
// generated diff locally and verifies the result digest before any caller trusts
// it, so a suboptimal (but correct) diff is fine and a buggy one degrades to a
// whole-blob upload rather than a finalize conflict.

const NO_NEWLINE_MARKER = "\\ No newline at end of file";

type Line = { text: string; hasTerminator: boolean };

// Split into lines on raw LF. The text excludes the terminating LF (matching the
// applier's content comparison) but keeps any CR, so CRLF round-trips. A trailing
// segment with no LF is a line without a terminator.
function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      lines.push({ text: text.slice(start, i), hasTerminator: true });
      start = i + 1;
    }
  }
  if (start < text.length) {
    lines.push({ text: text.slice(start), hasTerminator: false });
  }
  return lines;
}

// Longest-common-subsequence table over line text, walked back into an edit script.
type Op = { kind: "equal" | "delete" | "add"; oldIndex?: number; newIndex?: number };

function lcsOps(base: Line[], next: Line[]): Op[] {
  const n = base.length;
  const m = next.length;
  const baseText = base.map((line) => line.text);
  const nextText = next.map((line) => line.text);
  // Flat (n+1)*(m+1) table; typed-array indexing is always a number (no undefined).
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  const at = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = baseText[i] === nextText[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (baseText[i] === nextText[j]) {
      ops.push({ kind: "equal", oldIndex: i, newIndex: j });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      ops.push({ kind: "delete", oldIndex: i });
      i++;
    } else {
      ops.push({ kind: "add", newIndex: j });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "delete", oldIndex: i++ });
  while (j < m) ops.push({ kind: "add", newIndex: j++ });
  return ops;
}

const CONTEXT_LINES = 3;

// A "\ No newline" marker is emitted immediately after the last line of a side when
// that line has no terminator. The applier reads it as "the preceding emitted line
// carries no trailing newline".
function lineBody(line: Line, prefix: string): string[] {
  if (line.hasTerminator) {
    return [`${prefix}${line.text}`];
  }
  return [`${prefix}${line.text}`, NO_NEWLINE_MARKER];
}

type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; body: string[] };

// Group the LCS edit script into hunks, each carrying up to CONTEXT_LINES of
// unchanged context around its changes. Runs of >2*CONTEXT equal lines split the
// hunk so the diff stays small on large files. Line numbers are 1-based; oldLines
// counts context+deletes, newLines counts context+adds.
function buildHunks(base: Line[], next: Line[], ops: Op[]): Hunk[] {
  const changeIndexes = ops.map((op, i) => (op.kind === "equal" ? -1 : i)).filter((i) => i >= 0);
  if (changeIndexes.length === 0) {
    return [];
  }
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < changeIndexes.length) {
    const startOp = changeIndexes[i] ?? 0;
    const hunkStart = Math.max(0, startOp - CONTEXT_LINES);
    // Extend through changes that are within 2*CONTEXT equal lines of each other.
    let endOp = startOp;
    let j = i;
    while (
      j + 1 < changeIndexes.length &&
      (changeIndexes[j + 1] ?? 0) - (changeIndexes[j] ?? 0) <= 2 * CONTEXT_LINES + 1
    ) {
      endOp = changeIndexes[j + 1] ?? endOp;
      j++;
    }
    const hunkEnd = Math.min(ops.length - 1, endOp + CONTEXT_LINES);
    hunks.push(materializeHunk(base, next, ops, hunkStart, hunkEnd));
    i = j + 1;
  }
  return hunks;
}

type HunkAccumulator = { body: string[]; oldLines: number; newLines: number; oldStart: number; newStart: number };

function emitEqual(acc: HunkAccumulator, line: Line, oldIndex: number, newIndex: number): void {
  if (acc.oldLines === 0) acc.oldStart = oldIndex;
  if (acc.newLines === 0) acc.newStart = newIndex;
  acc.body.push(...lineBody(line, " "));
  acc.oldLines++;
  acc.newLines++;
}

function emitDelete(acc: HunkAccumulator, line: Line, oldIndex: number): void {
  if (acc.oldLines === 0) acc.oldStart = oldIndex;
  acc.body.push(...lineBody(line, "-"));
  acc.oldLines++;
}

function emitAdd(acc: HunkAccumulator, line: Line, newIndex: number): void {
  if (acc.newLines === 0) acc.newStart = newIndex;
  acc.body.push(...lineBody(line, "+"));
  acc.newLines++;
}

function materializeHunk(base: Line[], next: Line[], ops: Op[], from: number, to: number): Hunk {
  const acc: HunkAccumulator = { body: [], oldLines: 0, newLines: 0, oldStart: 0, newStart: 0 };
  for (let k = from; k <= to; k++) {
    const op = ops[k];
    if (op?.kind === "equal" && op.oldIndex !== undefined && op.newIndex !== undefined) {
      const line = base[op.oldIndex];
      if (line) emitEqual(acc, line, op.oldIndex, op.newIndex);
    } else if (op?.kind === "delete" && op.oldIndex !== undefined) {
      const line = base[op.oldIndex];
      if (line) emitDelete(acc, line, op.oldIndex);
    } else if (op?.kind === "add" && op.newIndex !== undefined) {
      const line = next[op.newIndex];
      if (line) emitAdd(acc, line, op.newIndex);
    }
  }
  // 1-based; an empty side anchors at 0 so the applier's oldLines===0 rule applies.
  return {
    oldStart: acc.oldLines === 0 ? acc.oldStart : acc.oldStart + 1,
    oldLines: acc.oldLines,
    newStart: acc.newLines === 0 ? acc.newStart : acc.newStart + 1,
    newLines: acc.newLines,
    body: acc.body,
  };
}

function buildDiff(base: Line[], next: Line[]): string {
  const ops = lcsOps(base, next);
  const hunks = buildHunks(base, next, ops);
  const blocks = hunks.map(
    (h) => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.body.join("\n")}`,
  );
  return `${blocks.join("\n")}\n`;
}

/**
 * Generate a unified diff from `baseText` to `nextText`, verify it reconstructs to
 * the exact `nextBytes`, and return the diff bytes — or null when the file is
 * unchanged, the diff is not smaller than the new file, or the self-check fails
 * (caller should upload the whole file instead). `expectedResultSha256` is the
 * plaintext digest the server will verify the reconstruction against.
 */
export async function diffWithSelfCheck(input: {
  baseText: string;
  baseSha256: string;
  nextText: string;
  nextBytes: Uint8Array;
  expectedResultSha256: string;
}): Promise<Uint8Array | null> {
  if (input.baseText === input.nextText) {
    return null;
  }
  const base = splitLines(input.baseText);
  const next = splitLines(input.nextText);
  const diffText = buildDiff(base, next);
  const diffBytes = new TextEncoder().encode(diffText);
  if (diffBytes.byteLength >= input.nextBytes.byteLength) {
    return null;
  }
  const applied = await applyUnifiedDiff({
    baseBytes: new TextEncoder().encode(input.baseText),
    diffBytes,
    expectedBaseSha256: input.baseSha256,
    expectedResultSha256: input.expectedResultSha256,
  });
  return applied.ok ? diffBytes : null;
}
