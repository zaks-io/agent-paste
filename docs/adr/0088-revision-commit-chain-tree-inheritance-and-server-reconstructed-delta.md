# Revision Commit Chain, Tree Inheritance, And Server-Reconstructed Intra-File Delta

An agent that has already published an **Artifact** and wants to change one file
should be able to say "change this one file," not re-describe the whole tree. Two
gaps stand in the way today, both recorded as the missing half of
[ADR 0087](./0087-workspace-scoped-content-addressed-blob-deduplication.md):

1. **No tree inheritance.** A new **Revision** must re-enumerate every path with
   its `sha256`. Workspace blob dedup ([ADR 0087](./0087-workspace-scoped-content-addressed-blob-deduplication.md))
   skips the unchanged *bytes*, but the client still walks and hashes the whole
   directory and sends the full manifest. The smallest change an agent can express
   is "here is the entire new tree."
2. **No intra-file delta.** A blob is a whole file. One line changed in a 5 MB
   file is a new plaintext digest, a new blob, and a full 5 MB upload.

The driver is **agent ergonomics**: the natural unit of an agent's edit is "this
file changed" (and, for a large file, "this region of this file changed"), and the
contract should accept exactly that.

## Decision

Make the **Revision** model behave like a Git commit: a parent pointer plus a
tree that inherits from the parent and overrides only what changed. Layer
server-reconstructed intra-file delta on top so a big file with a small edit
uploads only the diff. **The encryption boundary
([ADR 0063](./0063-application-layer-encryption-for-artifact-bytes.md)) does not
change.**

### Tree inheritance and the commit chain

- `revisions` gains `parent_revision_id` (nullable self-reference within the same
  Artifact). Existing rows are roots (`NULL`). A Revision published against a base
  records that base as its parent.
- `CreateUploadSessionRequest` gains an optional `base_revision_id` and
  `deleted_paths`. When `base_revision_id` is set, the `files` manifest is
  "changed + added paths only"; every path present in the base and not listed or
  deleted **inherits by reference** — `api` copies the base's `artifact_files`
  row forward (it already points at a shared blob), so no bytes and no manifest
  entry are needed for unchanged files.
- The published Revision still materializes a complete `artifact_files` tree, so
  every downstream surface (content serving, bundles, byte purge, Agent View)
  is unchanged. "Inheritance" is a publish-time merge, not a read-time
  indirection. Diffing two Revisions' `artifact_files` rows yields the changeset.

### Server-reconstructed intra-file delta (the chosen delta option)

- A changed file may be sent as a **patch** instead of whole bytes: a per-file
  descriptor `{ base_sha256, format: "unified", result_sha256 }` plus the diff
  bytes uploaded on the normal upload path.
- Reconstruction runs in **`jobs`**, not `upload`. `jobs` fetches and decrypts
  the base blob, applies the patch, hashes the result, and **fails loud** unless
  it equals `result_sha256`. It then encrypts the **whole reconstructed file** as
  an ordinary `storage_kind = 'blob'` object under
  `workspaceBlobObjectKeyFor(result_sha256)`. This is the same
  read-decrypt-transform-reencrypt-write shape `jobs` already runs for Bundle
  generation (`bundle-generate-orchestration.ts`, `revision-file-bytes.ts`), so
  it deepens a module that is already that shape rather than expanding one that is
  not — see the placement rationale under Consequences.
- The resulting blob is indistinguishable from a whole-file upload. **`content`
  never learns a patch existed**, never reconstructs on read, and keeps its no-DB
  isolation and whole-object decrypt. Reconstruction happens once, on write,
  behind the encryption boundary.

### Patch format

**Unified diff for text; whole-blob upload for binary.** Agents reason natively
in unified diffs, so it is the ergonomic match for the driver, and it is
reviewable. Binary files rarely take tiny edits, and a byte-splice format is
fiddly for an agent to produce; a changed binary file just uploads a new whole
blob (the [ADR 0087](./0087-workspace-scoped-content-addressed-blob-deduplication.md)
status quo). The CLI/MCP choose patch vs whole-blob per file: patch only when the
file is large enough and the diff is small enough to be worth it; otherwise
whole-blob.

## Considered Options

- **Tree inheritance only; no intra-file delta.** This delivers most of the
  ergonomics (the agent sends only changed files) with zero encryption
  interaction, and is the independently shippable core (stages 1–3 of the plan).
  Not chosen as the endpoint because a big file with a one-line edit still
  re-uploads in full; chosen as the _foundation_ that intra-file delta sits on.
- **Intra-file delta only; no tree inheritance.** Rejected. Without inheritance
  the agent still re-enumerates every file each Revision, so the ergonomic win is
  small and the hardest piece (reconstruction) carries the least benefit.
- **Reconstruct on read in `content`.** Rejected. `content` has no database and
  decrypts whole objects in-memory with no Range/streaming-partial path; giving it
  base-revision + patch metadata means a DB binding or a side channel, which
  breaks the isolation that the **Content Origin** exists to provide
  ([ADR 0001](./0001-private-artifact-storage-behind-controlled-origin.md),
  [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md)).
- **Drop application-layer encryption to R2-only so ciphertext chunks become
  addressable.** Rejected here; this is the option
  [ADR 0063](./0063-application-layer-encryption-for-artifact-bytes.md) already
  weighed and declined, and it would put Cloudflare back inside the byte-
  confidentiality boundary. Not worth it for transient handoffs.
- **Content-defined chunk store with per-block AEAD.** Deferred. Maximum dedup
  and true delta storage, but it re-architects the storage layer and fights
  `content`'s no-DB isolation hardest. Revisit only if a real
  large-file-frequent-edit workload appears.
- **Tree inheritance + server-reconstructed intra-file delta (chosen).** Git
  commit semantics at file granularity, plus diff-on-the-wire for big files,
  reconstructed to whole blobs before encryption so the trust boundary and read
  path are untouched.

## Consequences

- **The agent expresses minimal change.** "Change this file" sends one file;
  "change this region of a big file" sends one diff. Unchanged files are neither
  re-hashed (the CLI caches the last manifest per Artifact) nor re-uploaded.
- **Revisions form a DAG-by-parent.** `parent_revision_id` enables real
  "what changed between Revision N and N+1" and a browsable history. Diff views in
  the viewer become possible but are out of scope here.
- **Storage is not reduced by intra-file delta.** Reconstruction writes a whole
  new blob; the saving is upload bandwidth, not stored bytes. This is an accepted
  trade for keeping encryption and the read path unchanged. A future chunk store
  is where stored-byte savings would come from.
- **Reconstruction is a new failure mode, handled loud.** A patch that does not
  apply, or whose result digest mismatches `result_sha256`, fails the
  upload/finalize with a clear error; it never serves a partially-applied file.
- **Reconstruction runs in `jobs` because that is the seam-honest placement.**
  `upload` is write-only against R2 today — its sole R2 op is
  `env.ARTIFACTS.put` (`apps/upload/src/put.ts:150`); it never reads or decrypts
  a stored object, even though it holds the DEK. Putting reconstruction there
  would turn a write-only module into a read-modify-write one and make
  base-blob decrypt a live path on the hot upload route, widening its blast
  radius. `jobs` is _already_ a read-modify-write module with the `ARTIFACTS`
  binding and the encryption ring: Bundle generation reads revision files,
  decrypts (`revision-file-bytes.ts`), and re-encrypts the output
  (`bundle-generate-orchestration.ts`). Reconstruction is the same operation
  shape, so it belongs there. The trade-off accepted: a patched file is not
  servable until its `jobs` reconstruction completes, so a Revision that contains
  a patched file has a brief pending state before Publish can resolve it —
  modeled like the existing async Bundle/safety-scan pending states, not as a
  finalize-blocking step. This supersedes the earlier draft note that started
  reconstruction in `upload`.
  **Superseded at implementation (see "Stage 4 implementation notes" below):**
  reconstruction shipped SYNCHRONOUSLY at finalize in `upload`, not async in
  `jobs`, and there is no pending state. The async/pending framing was reversed
  because a patch that cannot apply must fail the agent's finalize call so the
  agent can fix it (the conflict is the feature), which a fire-and-forget job
  cannot do.
- **Caps still apply to the reconstructed result**, not the diff: a small diff
  whose applied result exceeds the file/Revision cap fails.
- **Spec + glossary updates.** [`data-model.md`](../specs/data-model.md)
  (`parent_revision_id`), [`api.md`](../specs/api.md) (`base_revision_id`,
  `deleted_paths`, patch descriptor, partial-manifest publish), and
  [`CONTEXT.md`](../../CONTEXT.md) relationships ("a **Revision** has zero or one
  parent **Revision**"; a new Revision may inherit unchanged files from its
  parent) are updated so the spec stays source of truth. No new top-level domain
  term is introduced for "patch"; it is an implementation property of how a
  changed file is transmitted.

## Stage 3 implementation notes (tree inheritance at finalize)

Decisions surfaced while building the api tree-inheritance step, recorded so the
next implementer does not re-derive them:

- **The merge runs at finalize, not at session create.** The session-create
  alternative was considered (the base is already known there) and rejected: it
  contradicts this ADR's "publish-time merge" framing and would write inherited
  rows into `upload_session_files` that the client would then be asked to PUT.
  Keeping the merge at finalize is also strictly less code (the wire builder,
  observe loop, and upload worker are untouched). The session carries the intent
  via `upload_sessions.base_revision_id` and `upload_sessions.deleted_paths`.
- **Inheritance requires `base.status = 'published'` and blob-backed paths only.**
  A draft base is uncommitted (and unreachable as a base anyway, since a session
  on the same Artifact hits `draft_revision_conflict` first); a retained base's
  blobs fall out of the GC refcount. A `storage_kind = 'revision'` base path is
  not refcount-protected, so it is rejected (`inherited_path_not_blob_backed`)
  rather than copied forward into a dangling reference.
- **The composite `revisions_parent_fk` is the DB backstop** for a cross-artifact
  or cross-workspace parent. The app validates the base belongs to the same
  Artifact (`base_revision_artifact_mismatch`) and Workspace
  (`base_revision_not_found`) and fails fast before the foreign key would 500.
- **A patched file's diff bytes upload as a revision-scoped object with `sha256`
  omitted** from the signed payload (the signed-blob-key assertion in the upload
  worker only fires when `sha256` is signed). The patch descriptor
  (`patch_base_sha256`, `patch_result_sha256`) is recorded on
  `upload_session_files` so a later `jobs` step can reconstruct the result blob.
  Stage 3 validates `base_sha256` against the base file but does not apply the
  diff.
- **Stage 3 refuses to finalize a patched file** (`patch_reconstruction_unavailable`).
  Without Stage 4's reconstruction, finalizing would commit the raw diff bytes as
  the served file. The descriptor is still recorded and validated at create so the
  wire path is exercised, but the publish flow fails loud until reconstruction
  exists. This guards a hand-rolled API/MCP caller even though no first-party
  client emits patches until Stage 5. A file may not declare both a whole-file
  `sha256` and a `patch` (rejected at request validation).

This confirms, and does not reverse, the Stage 2 "applied at finalize" wording.

## Stage 4 implementation notes (synchronous reconstruct-at-finalize)

Stage 4 reverses two specifics of the "Server-reconstructed intra-file delta"
decision above (placement and the pending model). The reasons, so the next
implementer trusts these notes over the earlier framing:

- **The conflict is the feature, so reconstruction is synchronous and fails the
  finalize call.** The whole point of intra-file delta is agent ergonomics: when a
  diff cannot be applied (base moved, hunk fails, result digest mismatch), the
  system must flag that back to the agent in the same request so the agent
  re-submits a corrected diff. An async `jobs` job with a pending state cannot fail
  the caller's call; it can only 404 or DLQ, which buries the signal. So
  reconstruction runs inline at finalize and a conflict throws
  `RevisionReconstructionConflict` → `patch_conflict` (HTTP 422), message
  `patch_conflict: <path>: <reason>`. There is **no pending state and no
  `reconstruction_status` column** — a broken patch never becomes a draft, so a
  servable-but-broken revision cannot exist.
- **Placement is finalize in `upload`, not `jobs`.** The blast-radius argument for
  `jobs` assumed async; synchronous reconstruction must run where the finalize
  transaction is, and finalize already owns the patch gate, the only
  `artifact_files` write, and the result-size cap-check. `upload` already holds the
  encryption ring; the only new capability is R2 `get`. Blast radius is contained
  by never exposing an arbitrary-key read in app code: the reconstructor
  (`RevisionReconstructor`, injected via `RepositoryOptions` like the reparent
  migrator) takes a validated `(workspaceId, sha256)` derived from the base
  Revision's own `artifact_files` rows. The decrypt/apply/encrypt logic is shared
  in `packages/storage` (`unified-diff.ts` applier, `workspace-blob-bytes.ts`
  read/write helpers), invoked from `packages/db/src/postgres/revision-reconstructor.ts`.
- **The applier is hand-rolled and byte-exact.** No diff library: `jsdiff` fuzzes
  hunks and round-trips through UTF-16, which breaks byte-exactness against the
  raw-byte `result_sha256` digest and yields false conflicts. The applier splices
  raw base byte ranges for context/unchanged regions and never normalizes
  CRLF/BOM/trailing-newline. `result_sha256` is the backstop, so conflict reasons
  are coarse (`parse_error | base_hash_mismatch | apply_failed |
result_hash_mismatch`) — the agent's only action on any of them is "regenerate
  this file's diff", so hunk/line forensics would be unusable detail.
- **The result is an ordinary content-addressed blob (Option 1 holds).** Finalize
  replaces the diff placeholder with a `storage_kind='blob'` `artifact_files` row
  and registers a `content_blobs` row in the same transaction (so GC protects the
  new blob). `content`, bundles, and GC are unchanged. No DB migration.
- **The Stage 3 `patch_reconstruction_unavailable` gate is removed** and replaced
  by the reconstruction call. Infra failures (missing ring/R2, decrypt errors) map
  to `storage_unavailable` (503), never `patch_conflict`, so the agent is never
  told "your patch is bad" for an outage. First-failure-wins across multiple
  patched files; all files apply+verify in memory before any blob is PUT, so a
  batch with one conflict writes zero blobs.

## What this ADR is not

- Not a chunk store, not per-block encryption, not Range serving, not global
  dedup, not dropping encryption. Those are explicitly deferred above.
- Not a read-time change. Nothing about how a published file is served changes;
  a reconstructed file is an ordinary blob.
- Not a license to expose Revision internals to recipients. The commit chain is
  owner/member and agent metadata; Access Link recipients still see the published
  tree, not the history, unless a separate decision opens it.
