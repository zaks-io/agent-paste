// Literal multi-edit core for the client-side revise engine (ADR 0091). Pure
// string in, result or typed failure out: it never hashes, reads, or publishes.
// Matching is LITERAL (indexOf scan, never a constructed RegExp) so there are no
// escaping bugs and no ReDoS. Edits apply in order — edit n sees edit n-1's output.

export type Edit = {
  oldString: string;
  newString: string;
  /** Replace every occurrence instead of requiring a unique match. */
  replaceAll?: boolean;
};

export type ApplyEditsFailure = "empty_old_string" | "not_found" | "not_unique";

export type ApplyEditsResult = { ok: true; body: string } | { ok: false; reason: ApplyEditsFailure; index: number };

/**
 * Apply ordered literal `{ oldString, newString }` replacements to `body`.
 *
 * Fails fast on the first bad edit, returning its `index`:
 * - empty `oldString` is rejected before any scan;
 * - an `oldString` that does not occur is `not_found`;
 * - an `oldString` that occurs more than once without `replaceAll` is `not_unique`.
 *
 * `replaceAll` collapses every occurrence (literal split/join). Otherwise the
 * single occurrence is replaced by index, never via regex.
 */
export function applyEdits(body: string, edits: Edit[]): ApplyEditsResult {
  let current = body;
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index];
    if (!edit || edit.oldString.length === 0) {
      return { ok: false, reason: "empty_old_string", index };
    }
    const first = current.indexOf(edit.oldString);
    if (first === -1) {
      return { ok: false, reason: "not_found", index };
    }
    if (edit.replaceAll === true) {
      current = current.split(edit.oldString).join(edit.newString);
      continue;
    }
    // Scan from first + 1, not first + oldString.length, so an overlapping second
    // match (oldString "aa" in "aaa") is still ambiguous and fails loud rather than
    // silently replacing at index 0. Ambiguity is the one thing this engine must refuse.
    const second = current.indexOf(edit.oldString, first + 1);
    if (second !== -1) {
      return { ok: false, reason: "not_unique", index };
    }
    current = current.slice(0, first) + edit.newString + current.slice(first + edit.oldString.length);
  }
  return { ok: true, body: current };
}
