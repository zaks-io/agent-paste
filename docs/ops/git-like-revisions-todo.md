# Git-like revisions: tree-inheritance + intra-file delta

Design + staged plan for making revision storage behave more like Git so agents
can express _small changes to a file_ instead of re-submitting the whole tree,
and so a big file getting a small edit does not re-upload the whole file.

Owner: Isaac. Drafted 2026-06-14. Status: design accepted, not yet implemented.
Driver: **agent ergonomics** (the agent saying "change just this file" cheaply
and naturally is the point; byte savings are secondary).

## Where we are today (verified ground truth)

The blob layer is **already half-Git**:

- Content-addressed whole-file blobs: `content_blobs(workspace_id, sha256,
size_bytes)` -> shared R2 object `workspaces/{wid}/blobs/sha256/{prefix}/{sha256}`
  (`packages/storage/src/artifact-bytes-encryption.ts` `workspaceBlobObjectKeyFor`).
- Whole-file dedup: client sends a `(path, size, sha256)` manifest; server marks
  files `reused` when the blob exists, client skips the PUT
  (`packages/db/src/upload-session-lifecycle.ts:47-66`,
  `packages/db/src/repository/upload-session-lifecycle.ts:84-104`).
- The CLI already streams a plaintext SHA-256 per file (`sha256HexForFile` in
  `apps/cli/src/local.ts:129`).

What is **missing** vs Git:

1. **No commit chain.** `revisions` has no `parent_revision_id`
   (`packages/db/src/schema.ts:237`). Revisions are a flat numbered list.
2. **No tree inheritance.** A new revision must re-enumerate _every_ path. The
   client still walks + hashes the whole directory each publish; dedup only saves
   the bytes, not the enumeration or the "send the whole dir" mental model.
3. **No intra-file delta.** A blob is a whole file. One line changed in a 5 MB
   file -> new SHA-256 -> full 5 MB re-upload.

## Architecture constraint that shapes the design (the seams)

| Seam      | Owns                                   | DB        | R2        | Constraint                                                                 |
| --------- | -------------------------------------- | --------- | --------- | -------------------------------------------------------------------------- |
| cli / mcp | client hashing, publish verb           | -         | -         | already hashes plaintext sha256                                            |
| api       | durable DB writes, publish coord       | yes       | read-only | **only place** commit-graph / tree metadata can be written                 |
| upload    | R2 PUT, encrypt-before-write, finalize | yes       | PUT       | owns reused/upload_required; per-workspace DEK                             |
| content   | serving untrusted bytes                | **no DB** | read-only | decrypts **whole** object in-memory, no Range, cannot reach patch metadata |

Two facts decide everything:

- **Ciphertext is not content-addressable** (random IV per encrypt). Dedup works
  because the key is the _plaintext_ SHA-256. Blob encryption already uses a
  distinct AAD `v2 = (workspaceId, sha256)` with no path/revision binding
  (`artifact-bytes-encryption.ts:7-8,27-31`), so a blob is reusable across
  revisions by construction.
- **`content` has no DB and decrypts whole objects.** It can never reconstruct a
  file from base + patch. So **any intra-file delta must be reconstructed on the
  write path (`upload`/`jobs`) into a normal whole blob**, never on read.

### On encryption (ADR 0063)

Encryption defends exactly **platform-tier** risk (Cloudflare-side R2
misconfiguration / object-store insider), as defense-in-depth over R2's own
at-rest encryption. It explicitly does **not** defend the viewer tier (a leaked
Access Link still serves the bytes). It is therefore a _posture_ property, low as
a user-facing control. **We keep it as-is.** The chosen design (Option 1 below)
preserves the encryption boundary completely: deltas are reconstructed to whole
blobs before encryption, so `content` and the trust boundary never change.

## Decision

Build **both layers**, optimize for agent ergonomics, leave encryption untouched:

- **Layer 1 - tree + commit chain** (file-granularity "change just this file").
- **Option 1 intra-file delta** on top (big-file-small-edit byte savings),
  reconstructed server-side into a whole blob.

Sub-file _chunk store_ / per-block AEAD / dropping encryption to R2-only are
explicitly **out of scope** and deferred until usage proves the need ("if people
use this, refactor later").

### Patch format (recommended)

**Unified diff for text, whole-blob fallback for binary.**

- Agents reason natively in unified diffs; it is the ergonomic match for the
  driver. Human-readable, reviewable, and the agent already produces them.
- Binary files rarely get tiny edits; forcing a byte-splice format on agents buys
  little and is fiddly. Binary changes just upload a new whole blob (status quo).
- The server applies the diff to the decrypted base blob, hashes the result,
  verifies it against a client-declared `result_sha256`, and writes a new whole
  blob. **Fail loud** if the patch does not apply cleanly or the result hash
  mismatches (never silently fall back to a partial file).

## Staged plan

### Stage 0 - Write the ADR(s) first (decision on record before code)

- The whole blob-dedup subsystem shipped **without an ADR** (commit `dea091f4`,
  documented only in `data-model.md`/`api.md`). Write the retroactive ADR for
  workspace-scoped content-addressed blobs.
- New ADR: "Revision commit chain + tree inheritance + server-reconstructed
  intra-file delta." Record: parent pointer, partial-manifest contract, Option 1
  reconstruct-on-write, encryption left intact, chunk-store deferred.
- Done: both ADRs merged; `data-model.md` + `api.md` + `CONTEXT.md` updated so
  spec stays source of truth.

### Stage 1 - Schema: parent pointer

- Add `revisions.parent_revision_id TEXT NULL` self-FK within the same artifact
  (composite-safe, mirrors existing `(workspace_id, artifact_id, id)` unique).
- Backfill: leave NULL for existing rows (they are roots). No data migration.
- Done: migration applies clean on PGlite + Neon; index added if diff queries
  need it.

### Stage 2 - Contract: base revision + partial manifest

- `CreateUploadSessionRequest` (in `packages/contracts`): add optional
  `base_revision_id` and `deleted_paths: string[]`. When `base_revision_id` is
  set, `files` becomes "changed + added only"; unlisted paths inherit from base.
- Add a per-file optional `patch` descriptor: `{ base_sha256, format: "unified",
result_sha256 }` plus the diff bytes uploaded like any file body. Absence =
  whole-file upload (today's behavior).
- Validate: `base_revision_id` must belong to the same artifact + workspace;
  `deleted_paths` must exist in base; patch `base_sha256` must match the base
  revision's file at that path.
- Done: contract + OpenAPI regenerated; round-trip tests for partial manifest and
  patch descriptor.

### Stage 3 - api: tree inheritance at finalize/publish - DONE

- When finalizing against `base_revision_id`: copy forward the base's
  `artifact_files` rows for inherited paths (already point at shared blobs),
  apply overrides + `deleted_paths`. This is the "commit = parent tree + delta"
  step. Set `parent_revision_id = base_revision_id`.
- Recompute `file_count` / `size_bytes` from the merged tree.
- Done: a revision published with one changed file has a full `artifact_files`
  tree but only one new blob; `parent_revision_id` set; diffing two revisions'
  `artifact_files` yields the changeset.
- Landed: merge runs at finalize (`mergeBaseRevisionTree` in
  `packages/db/src/repository/upload-session-lifecycle.ts`); session carries
  `base_revision_id` + `deleted_paths`; patched files record a descriptor
  (`patch_base_sha256` / `patch_result_sha256`) on `upload_session_files` with
  `sha256` omitted from the signed PUT. Stateful validation (published base,
  same workspace/artifact, blob-backed-only inheritance, deleted-path-in-base,
  patch base match) with six new repo error codes mapped to `invalid_request`.
  See the ADR 0087 Stage 3 implementation notes for the decisions.

### Stage 4 - synchronous reconstruct-at-finalize (DONE)

Reconstruction runs **synchronously at finalize, in the `upload` worker**, BEFORE
the new Revision is committed as a draft. (An earlier sketch put this async in
`jobs`; that was rejected because a patch that cannot apply must FLAG BACK to the
agent so the agent can fix it - the conflict is the feature, not bookkeeping. A
broken patch must never produce a servable revision, so reconstruction has to be
able to FAIL the finalize call. Finalize is also where the patch gate, the only
`artifact_files` write, and the result-size cap-check already live, and the
`upload` worker already holds R2 + the encryption ring.)

- A patched file uploads a unified diff (sha256 null, revision-scoped key). At
  finalize, before any DB write, `mergeBaseRevisionTree` validates the diff base
  against the base Revision's file (`patch_base_mismatch`) then runs the injected
  `RevisionReconstructor` (`packages/db/src/postgres/revision-reconstructor.ts`):
  decrypts the base blob, applies the diff (`packages/storage/src/unified-diff.ts`,
  a hand-rolled byte-exact applier), verifies `sha256(result) === result_sha256`,
  and encrypts the **whole result** as a normal blob under
  `workspaceBlobObjectKeyFor(result_sha256)`. All files apply+verify in memory
  first; only then are blobs PUT (a multi-file batch with one conflict writes zero
  blobs).
- A patch that cannot apply throws `RevisionReconstructionConflict` -> finalize
  fails with `patch_conflict` (HTTP 422), message `patch_conflict: <path>: <reason>`
  (`parse_error | base_hash_mismatch | apply_failed | result_hash_mismatch`), so
  the agent regenerates that file's diff and re-finalizes. Infra failures
  (missing ring/R2, decrypt) stay `storage_unavailable` (503), never a conflict.
  First-failure-wins across multiple patched files.
- The committed `artifact_files` row is an ordinary `storage_kind='blob'` row +
  a `content_blobs` row (registered in the same tx so GC protects it). Nothing
  downstream (content, bundles, GC) knows a patch was involved. No new DB column,
  no `reconstruction_status`, no migration.
- Caps run on the MERGED tree carrying RECONSTRUCTED result sizes (a patched
  file's session `size_bytes` is the diff size), so a result over cap is rejected.
- Security: `upload` gains R2 `get`, but app code never reads an arbitrary key -
  the reconstructor takes a validated `(workspaceId, sha256)` derived from the
  base Revision's own `artifact_files` rows.
- Done: big-file-small-edit uploads only the diff bytes; served file is
  byte-identical to applying the patch locally; `content` unchanged.

### Stage 5 - cli/mcp: the ergonomics payoff

- CLI caches the last published manifest per artifact (paths + sha256 + revision
  id) locally. On revise: diff the working dir against the cache; send only
  changed/added files + `deleted_paths` against `base_revision_id`. **Unchanged
  files are not re-hashed and not re-uploaded.**
- For a changed _text_ file above a size threshold, generate a unified diff
  against the cached base and send the patch instead of the whole file. Below
  threshold or binary: whole blob (cheaper than diff overhead).
- MCP `add_revision`: accept a partial file set + optional per-file patch, same
  contract. This is the no-shell parity surface.
- Done: agent expresses "change one file" and the wire carries one diff; demo on
  a multi-MB asset with a one-line edit.

## Non-goals / deferred

- Content-defined chunk store, per-block AEAD, Range serving, dropping to
  R2-only encryption. Revisit only if a real large-file-frequent-edit workload
  appears.
- Cross-workspace (global) blob dedup. Stays workspace-scoped (tenant blast
  radius, per ADR 0063 reasoning).
- Diff views in the viewer. The commit chain makes it possible; not in scope.

## Open questions

- Patch byte threshold for choosing diff vs whole-blob upload (measure; start
  conservative, e.g. only diff when `diff_size < 0.5 * file_size` AND file
  > a few hundred KB).
- RESOLVED: reconstruction runs in `jobs` (seam-honest; `upload` is write-only
  today, `jobs` already does the read-decrypt-transform-reencrypt-write shape).
  Remaining sub-question: exact pending-state model for a Revision whose Publish
  waits on reconstruction (reuse Bundle `pending` machinery vs a new state).
