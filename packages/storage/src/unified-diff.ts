// ADR 0087 Stage 4 intra-file delta: apply an agent-uploaded unified diff to a base
// blob and commit the whole reconstructed result. A patch that cannot be applied
// cleanly is a first-class, agent-visible CONFLICT (the agent re-submits a corrected
// diff), never a silent failure. Reconstruction is byte-exact: the result digest must
// equal the client-declared result_sha256, so this applier NEVER normalizes line
// endings, BOM, or trailing newlines. It reconstructs by copying raw base byte ranges
// for unchanged/context/deleted lines and emitting the diff's own raw bytes for added
// lines, so even non-UTF-8 content round-trips bit-for-bit.

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;
const NO_NEWLINE_MARKER = "\\ No newline at end of file";

export type ApplyConflictReason = "parse_error" | "base_hash_mismatch" | "apply_failed" | "result_hash_mismatch";

export type ApplyUnifiedDiffResult = { ok: true; result: Uint8Array } | { ok: false; reason: ApplyConflictReason };

type DiffLine =
  | { kind: "context"; text: string }
  | { kind: "delete"; text: string }
  | { kind: "add"; text: string }
  | { kind: "no_newline" };

type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

// A base line is the raw byte range it occupies INCLUDING its terminator; the final
// line may have no terminator. Splitting on raw bytes (not decoded text) keeps the
// copy byte-exact regardless of encoding.
type BaseLine = { start: number; end: number; hasTerminator: boolean };

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function asBufferSource(bytes: Uint8Array): BufferSource {
  if (bytes.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return Uint8Array.from(bytes);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", asBufferSource(bytes))));
}

// Decode UTF-8, returning null on any invalid sequence. `TextDecoder({ fatal: true })`
// is the obvious tool but its option type is not in every Worker TS lib config, so we
// decode lossily then verify the decode round-trips to the same bytes — a replacement
// character inserted for an invalid sequence re-encodes to different bytes.
function decodeUtf8Strict(bytes: Uint8Array): string | null {
  const text = new TextDecoder().decode(asBufferSource(bytes));
  if (!bytesEqual(new TextEncoder().encode(text), bytes)) {
    return null;
  }
  return text;
}

// Split the base into lines by raw LF byte (0x0a). A trailing "\r" stays part of the
// line's content range, so CRLF files round-trip; only the LF is the boundary.
function splitBaseLines(base: Uint8Array): BaseLine[] {
  const lines: BaseLine[] = [];
  let start = 0;
  for (let i = 0; i < base.length; i++) {
    if (base[i] === 0x0a) {
      lines.push({ start, end: i + 1, hasTerminator: true });
      start = i + 1;
    }
  }
  if (start < base.length) {
    lines.push({ start, end: base.length, hasTerminator: false });
  }
  return lines;
}

const FILE_HEADER = /^(---|\+\+\+|diff |index |old mode|new mode|similarity|rename|copy|new file|deleted file)/u;

// Parse one diff body line. The trailing empty string from a final "\n" split is the
// caller's concern; here a bare "" is an empty context line. Returns null on a bad marker.
function parseDiffLine(raw: string): DiffLine | null {
  if (raw === NO_NEWLINE_MARKER) {
    return { kind: "no_newline" };
  }
  if (raw === "") {
    // Some tools strip the single leading space of an empty context line.
    return { kind: "context", text: "" };
  }
  const text = raw.slice(1);
  switch (raw[0]) {
    case " ":
      return { kind: "context", text };
    case "-":
      return { kind: "delete", text };
    case "+":
      return { kind: "add", text };
    default:
      return null;
  }
}

// Advance past any leading file headers (---/+++/diff/index). Returns the index of the
// first hunk header, or null if a non-header line appears before any @@ (malformed).
function skipFileHeaders(rawLines: string[]): number | null {
  let i = 0;
  while (i < rawLines.length && !HUNK_HEADER.test(rawLines[i] ?? "")) {
    const line = rawLines[i] ?? "";
    if (line !== "" && !FILE_HEADER.test(line)) {
      return null;
    }
    i++;
  }
  return i < rawLines.length ? i : null;
}

function parseHunkHeader(line: string): Omit<Hunk, "lines"> | null {
  const header = HUNK_HEADER.exec(line);
  if (!header) {
    return null;
  }
  return {
    oldStart: Number(header[1]),
    oldLines: header[2] === undefined ? 1 : Number(header[2]),
    newStart: Number(header[3]),
    newLines: header[4] === undefined ? 1 : Number(header[4]),
  };
}

function parseHunks(diffText: string): Hunk[] | null {
  const rawLines = diffText.split("\n");
  const hunks: Hunk[] = [];
  let i = skipFileHeaders(rawLines);
  if (i === null) {
    return null;
  }
  while (i < rawLines.length) {
    // A trailing empty string from a final "\n" split is benign; anything else is junk.
    if ((rawLines[i] ?? "") === "" && i === rawLines.length - 1) {
      break;
    }
    const head = parseHunkHeader(rawLines[i] ?? "");
    if (!head) {
      return null;
    }
    i++;
    const lines: DiffLine[] = [];
    while (i < rawLines.length && !HUNK_HEADER.test(rawLines[i] ?? "")) {
      if ((rawLines[i] ?? "") === "" && i === rawLines.length - 1) {
        i++; // Trailing newline after the last hunk body line.
        break;
      }
      const diffLine = parseDiffLine(rawLines[i] ?? "");
      if (!diffLine) {
        return null;
      }
      lines.push(diffLine);
      i++;
    }
    hunks.push({ ...head, lines });
  }
  return hunks.length > 0 ? hunks : null;
}

const encoder = new TextEncoder();

// Match a diff context/delete line against the base line at `cursor`, comparing raw
// bytes (the line content excludes its LF terminator but, for CRLF, includes the CR).
function baseLineMatches(base: Uint8Array, baseLine: BaseLine, text: string): boolean {
  const contentEnd = baseLine.hasTerminator ? baseLine.end - 1 : baseLine.end;
  return bytesEqual(base.subarray(baseLine.start, contentEnd), encoder.encode(text));
}

type HunkApplication = { out: Uint8Array[]; cursor: number };

// Apply one hunk starting at `cursor`, returning the emitted byte ranges and the new
// cursor, or null on any mismatch / out-of-range. Hunks must arrive in forward order.
function applyHunk(base: Uint8Array, baseLines: BaseLine[], hunk: Hunk, cursor: number): HunkApplication | null {
  // Hunk line numbers are 1-based; an empty old side (oldLines 0) anchors AFTER oldStart,
  // so the first changed line is oldStart (insert) — normalize to 0-based.
  const hunkStart = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
  if (hunkStart < cursor || hunkStart > baseLines.length) {
    return null;
  }
  const out: Uint8Array[] = [];
  // Copy untouched base lines between the cursor and this hunk, byte-for-byte.
  for (let l = cursor; l < hunkStart; l++) {
    const line = baseLines[l];
    if (!line) {
      return null;
    }
    out.push(base.subarray(line.start, line.end));
  }
  let at = hunkStart;
  for (let idx = 0; idx < hunk.lines.length; idx++) {
    const diffLine = hunk.lines[idx];
    if (!diffLine || diffLine.kind === "no_newline") {
      continue;
    }
    if (diffLine.kind === "context" || diffLine.kind === "delete") {
      const baseLine = baseLines[at];
      if (!baseLine || !baseLineMatches(base, baseLine, diffLine.text)) {
        return null;
      }
      if (diffLine.kind === "context") {
        out.push(base.subarray(baseLine.start, baseLine.end));
      }
      at++;
    } else {
      // An added line carries a terminator unless a following "\ No newline" marker says
      // otherwise (the last line of a no-trailing-newline result).
      const followedByNoNewline = hunk.lines[idx + 1]?.kind === "no_newline";
      out.push(encoder.encode(followedByNoNewline ? diffLine.text : `${diffLine.text}\n`));
    }
  }
  return { out, cursor: at };
}

// Apply parsed hunks against the raw base, splicing raw byte ranges so the output is
// byte-exact. Returns null on any apply failure (context mismatch, out-of-range,
// overlapping/out-of-order hunks).
function applyHunks(base: Uint8Array, baseLines: BaseLine[], hunks: Hunk[]): Uint8Array | null {
  const out: Uint8Array[] = [];
  let cursor = 0; // next base LINE index (0-based) not yet emitted.
  for (const hunk of hunks) {
    const applied = applyHunk(base, baseLines, hunk, cursor);
    if (!applied) {
      return null;
    }
    out.push(...applied.out);
    cursor = applied.cursor;
  }
  // Copy any base lines after the last hunk.
  for (let l = cursor; l < baseLines.length; l++) {
    const line = baseLines[l];
    if (!line) {
      return null;
    }
    out.push(base.subarray(line.start, line.end));
  }
  return concatBytes(out);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Apply a unified-diff patch to a base blob, byte-exactly. The base must digest to
 * {@link input.expectedBaseSha256} and the applied result must digest to
 * {@link input.expectedResultSha256}; either mismatch is a conflict, never a stored
 * blob. The four conflict reasons are deliberately coarse: the only action an agent
 * can take on any of them is to regenerate the diff for this file, so hunk/line
 * forensics would be detail the agent cannot use.
 */
export async function applyUnifiedDiff(input: {
  baseBytes: Uint8Array;
  diffBytes: Uint8Array;
  expectedBaseSha256: string;
  expectedResultSha256: string;
}): Promise<ApplyUnifiedDiffResult> {
  // Defense-in-depth re-check of the DB-side patch_base_mismatch gate: guards against
  // a base blob mutated under us between the gate and the fetch.
  if ((await sha256Hex(input.baseBytes)) !== input.expectedBaseSha256) {
    return { ok: false, reason: "base_hash_mismatch" };
  }

  const diffText = decodeUtf8Strict(input.diffBytes);
  if (diffText === null) {
    return { ok: false, reason: "parse_error" };
  }

  const hunks = parseHunks(diffText);
  if (!hunks) {
    return { ok: false, reason: "parse_error" };
  }

  const baseLines = splitBaseLines(input.baseBytes);
  const result = applyHunks(input.baseBytes, baseLines, hunks);
  if (!result) {
    return { ok: false, reason: "apply_failed" };
  }

  if ((await sha256Hex(result)) !== input.expectedResultSha256) {
    return { ok: false, reason: "result_hash_mismatch" };
  }

  return { ok: true, result };
}
