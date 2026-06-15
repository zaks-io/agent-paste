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
  See the ADR 0089 Stage 3 implementation notes for the decisions.

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

### Stage 5 - cli/mcp: the ergonomics payoff + agent read-back (DONE)

See [ADR 0090](../adr/0090-agent-file-read-back-api-decrypts-member-plaintext.md)
for the decision record. The headline gap Stage 5 surfaced: an agent could not
**read a stored file back** to diff against, which is the prerequisite for
producing a correct patch when it lacks the working dir. So Stage 5 shipped both
the read-back and the CLI diff client.

- **Read-back.** `AgentViewFile` gains optional `sha256`. New member-authed `api`
  route `GET /v1/artifacts/{id}/file-content?path=&revision_id=` returns
  `{ path, sha256, size_bytes, content_type, is_binary, body? }` (text body when
  UTF-8 and ≤10 MiB; oversize skips the R2 read and returns metadata; binary sets
  `is_binary:true`, no body). `api` decrypts via `readWorkspaceBlobBytes` (the
  Stage 4 helper) — the first `api` byte-decrypt surface, member-only, boundary
  unchanged (ADR 0090). MCP gains a `read_file` tool forwarding to it.
- **CLI diff client.** The CLI caches the last published manifest per artifact
  (`paths + sha256 + revision_id`) under `configDir()`. On revise
  (`publish --artifact-id`): diff the working dir against the cache, send only
  changed/added files + `deleted_paths` against `base_revision_id`; unchanged
  files inherit by omission (not re-hashed, not re-uploaded). A changed text file
  is sent as a unified diff (`apps/cli/src/unified-diff-gen.ts`) only when the
  generator self-check (apply locally, verify result sha) passes AND the diff is
  smaller; otherwise whole-blob. **No size threshold** (KISS). A stale/unusable
  cached base → drop cache, re-publish whole once. New `agent-paste pull` verb
  reads a file back cat-like.
- **MCP `add_revision` stays text-body-only** (ADR 0084): the patch path needs a
  working dir, so it lives in the CLI; MCP gets read parity via `read_file`.
- Done: `pnpm smoke:local:patch` proves the partial+patch path end to end; a
  large file with a one-line edit uploads only the diff and serves byte-identical.

## Non-goals / deferred

- Content-defined chunk store, per-block AEAD, Range serving, dropping to
  R2-only encryption. Revisit only if a real large-file-frequent-edit workload
  appears.
- Cross-workspace (global) blob dedup. Stays workspace-scoped (tenant blast
  radius, per ADR 0063 reasoning).
- Diff views in the viewer. The commit chain makes it possible; not in scope.

## Open questions

- RESOLVED: no patch byte threshold. The CLI always sends a unified diff for a
  changed text file and a whole blob for binary (KISS; no magic numbers). The
  server byte-verifies and flags conflicts regardless of diff size, so a
  not-worth-it diff costs a few bytes of overhead, not correctness. Add a
  threshold only if a real large-file-frequent-edit workload proves it pays off.
- RESOLVED: reconstruction runs SYNCHRONOUSLY at finalize in the `upload` worker,
  not async in `jobs`. The conflict flag-back is the feature: a patch that cannot
  apply must FAIL the same finalize call with an agent-visible `patch_conflict`,
  so a broken patch never becomes a servable draft. There is therefore no
  pending-state model and no `reconstruction_status`. See the ADR 0089 Stage 4
  implementation notes.

## Next phase: shared revise engine + literal multi-edit (ADR 0091)

Status: design accepted (ADR 0091), not yet implemented. Lands AFTER the Stage
1–5 foundation (PR #529) merges, so the engine is built on settled code. This
section is the planned spec; the `docs/specs/cli.md` and `docs/mcp.md` live
sections are updated only when the code lands (specs are current truth).

**Supersedes** the "MCP `add_revision` stays text-body-only" line above: MCP gets
a real patch-revise path, and both surfaces express edits identically.

- **New package `@agent-paste/revise-core`** — pure, transport-agnostic (deps:
  `@agent-paste/storage`, `@agent-paste/contracts` only). Importable by both the
  Node CLI and the Worker MCP bundle.
- **`applyEdits(body, edits[])`** — ordered literal `{oldString, newString,
replaceAll?}`. `indexOf` matching (never a constructed `RegExp`). `not_found` if
  absent, `not_unique` if >1 without `replaceAll`, reject empty `oldString`. Edit
  _n_ sees edit _n−1_'s output. Pure in/out; never hashes/reads/publishes.
- **`RevisionReader { readArtifact, readFile }`** — the read-side seam, the twin
  of `PublishTransport`. CLI adapter over `ApiClient`; MCP adapter forwards
  `agentView.getLatest` + `artifacts.fileContent` over service bindings.
- **`reviseOnePath({reader, transport}, …)`** — read base identity + body →
  `applyEdits` → `diffWithSelfCheck` → partial-manifest `runPublish` (only the
  edited path; others inherit from `base_revision_id`).
- **Move `diffWithSelfCheck` + the unified-diff generator** out of `apps/cli` into
  the package (MCP cannot import `apps/cli`); the CLI working-dir revise imports
  them from there. No second copy.
- **Strict fail-fast** (the distinction from working-dir `publish`): `not_found` /
  `not_unique` / binary base / oversize base / missing path / `patch_conflict` are
  HARD errors — no silent whole-blob fallback. Only "diff not smaller than file"
  sends a whole-file entry (still under `base_revision_id`, result-`sha256`
  verified). A TOCTOU `patch_conflict` is retried ONCE by re-reading the current
  base and re-applying the literal edits; if the edit no longer matches → surface
  `not_found` (edit is stale, agent re-reads).
- **CLI `edit <artifact-id> <path> --old <s> --new <s> [...] [--replace-all]`** —
  repeatable old/new pairs, strict pairing, routes through `reviseOnePath` via the
  server read (no manifest cache needed; works on a fresh machine).
- **MCP `multi_edit { artifact_id, path, edits[] }`** — requires `read` + `publish`
  scopes. Contracts wiring: input/output schemas, `McpToolName` enum, tool-schemas
  maps, registry entry (forwards `agentView.getLatest` + `artifacts.fileContent`
  then the publish chain; declares `patch_conflict`), `mcp.test.ts` registry
  assertions.
- **MCP `add_revision` REBUILT** — reads the base and PRESERVES the existing title
  (fixes the bug where it overwrote it with the literal `"Revision"`; rename via
  `update_display_metadata`). Same-entrypoint → verified patch of the body against
  the stored entrypoint; `render_mode` change → whole-file fresh-entrypoint publish
  (the only meaningful whole-body replace); `sha256`-equal body → no-op, no
  revision. Idempotency key stays a pure function of tool args (the read never
  feeds it). Regression test: title preserved, not `"Revision"`. This is the one
  observable public-contract change — record in `docs/mcp.md` + `docs/specs/cli.md`
  when it lands; delete tests pinning `"Revision"` (they pinned a bug).
- **`render_mode` inheritance invariant** — finalize resolves `render_mode` as
  `session ?? base ?? infer(entrypoint)` so a partial-manifest revise that omits
  `render_mode` inherits the base's mode instead of silently re-inferring from the
  entrypoint. Gated behind finalize re-validation tests.

**Ship split:** PR1 = package + engine + move diff-gen + rebuild CLI/MCP onto it +
`add_revision` title fix + `render_mode` hardening (refactor, behavior-preserving
except the bug fix). PR2 = the `edit` + `multi_edit` verbs on top.

**Done (planned):** `pnpm verify` + `test:coverage` (88/82/88/88) + a preview e2e
against a REAL multi-file artifact — `cli:dev edit` patches one file (others
reused, link stable), `mcporter multi_edit` patches another, `add_revision`
preserves title + live-updates, a `render_mode` flip uses the whole-file fallback,
a repeated identical edit is a no-op, and the viewer reflects the change live.
