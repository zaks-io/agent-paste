# Persistent static hosting: implementation contract

Implementation contract for the approved scope in
[persistent-static-hosting.md](./persistent-static-hosting.md). Written
2026-11-02 against `b5fc7e86`, which includes the lockdown fix (`fca141c1`) and
the parent-owned bundle pre-read guard. This document replaces open questions in
the proposal with decisions. Workers implement it as written. If a contract here
is wrong, stop and tell the parent; don't improvise a parallel design.

Out of scope: platform lockdown (done in `fca141c1`), the bundle input guard
(parent-owned), production deploys, any backfill that deletes existing bytes,
and new billing tiers.

## 1. Decisions

| Topic              | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Large files        | In the guarded protocol, a file larger than `SINGLE_PUT_MAX_BYTES` (10 MiB) is stored in **chunked-v1** format: fixed 4 MiB chunks, each an ordinary workspace blob (`workspaces/{ws}/blobs/sha256/{xx}/{chunk_sha}`) encrypted by the existing AES-256-GCM blob path (AAD v2 = workspace + chunk sha256). No new cipher, AAD, key derivation or object key pattern.                                                                                                                                                                   |
| Chunk integrity    | Each chunk is verified by SHA-256 at PUT (existing `put.ts` behavior) and authenticated by GCM on read. Chunk order and total length come from an immutable, server-verified chunk list (`content_blob_chunks`) that is copied into the per-Revision file map. The map is authenticated by its SHA-256, which the HMAC-signed content token carries.                                                                                                                                                                                   |
| Whole-file digest  | `sha256` keeps one meaning everywhere: the SHA-256 of the full plaintext. For chunked files the upload Worker re-streams the stored chunks once at file completion, computes the digest with `node:crypto` `createHash`, and rejects mismatches. Dedup, preconditions, ETags and CLI comparisons stay keyed on `(sha256, size)`.                                                                                                                                                                                                       |
| Single-PUT ceiling | Guarded sessions use single signed PUTs up to 10 MiB. Legacy sessions preserve existing per-plan single-PUT limits, including 25 MiB on Pro, with an absolute `LEGACY_SINGLE_PUT_MAX_BYTES` ceiling of 25 MiB. Raising claimed file limits never enables a legacy single PUT above that ceiling.                                                                                                                                                                                                                                       |
| File cap           | 250 MiB = 262,144,000 bytes per file (claimed workspaces).                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Revision caps      | 10,000 files and 2 GiB (2,147,483,648 bytes) per Revision for claimed workspaces. Ephemeral workspaces keep 100 files, 10 MiB per file, 25 MiB per Revision and the 100-Revision ceiling.                                                                                                                                                                                                                                                                                                                                              |
| File map           | Every Revision published after this change gets one immutable JSON file map, stored as a workspace blob keyed by its own SHA-256 through `writeWorkspaceBlob`. It contains workspace, artifact and Revision IDs, so each Revision has its own map. `revisions.file_map_sha256/size_bytes` reference it. Content tokens carry `file_map: {sha256, size_bytes}` instead of `object_keys`. Revisions published before this change keep their current tokens. No sharding.                                                                 |
| Commit model       | New clients use **guarded commits**. Finalize (upload Worker) marks a session `ready` without creating a Revision row. `revisions.publish` (API) then locks the Artifact row, evaluates guards against the **current head**, merges the delta, writes the file map, inserts a `published` Revision, moves the head and applies pin intent, all in one Postgres transaction. The capability manifest is written after commit, as it is today. Drafts are not used in this flow, so concurrent disjoint sessions don't block each other. |
| Guards             | `paths`: every upserted or deleted path carries an expectation (`{sha256,size_bytes}` or `{absent:true}`), and each prefix deletion carries a prefix snapshot digest. `snapshot`: one prefix snapshot (or whole-tree snapshot) must match head. A new Artifact is a snapshot commit against the empty tree.                                                                                                                                                                                                                            |
| Legacy flow        | Sessions without `commit` keep the current draft flow. One safety change: legacy publish of a draft whose `parent_revision_id` is not the current head fails with `commit_conflict` (kind `head`) instead of silently dropping the intervening Revision. Full-tree legacy drafts with no parent keep last-writer-wins.                                                                                                                                                                                                                 |
| No-op              | If the merged tree, entrypoint, title and pin state equal head, publish returns the head Revision with `no_change: true` and creates no Revision. The CLI also skips session creation when its plan is empty.                                                                                                                                                                                                                                                                                                                          |
| Retention          | Publish-scoped API keys and MCP principals may pin and unpin within their own claimed workspace. Ephemeral workspaces get `forbidden`. Unpin sets `expires_at = now + default_ttl_seconds` for the workspace policy, for both web and agent unpin. Pin intent on publish is committed in the publish transaction.                                                                                                                                                                                                                      |
| Update ceiling     | `lifetime_revision_ceiling` becomes 2,147,483,647 (the physical `integer` limit of `revision_number`) for claimed workspaces. The storage budget now bounds history. All existing history is preserved.                                                                                                                                                                                                                                                                                                                                |
| Storage budget     | Defaults: Free 5 GiB, Pro 50 GiB. An operator can override per workspace through `workspaces.storage_budget_bytes`. Usage = live `single`-format blob bytes + legacy revision-scoped file bytes + ready bundle bytes + 1 KiB per file entry in live Revisions + reservations for not-yet-uploaded bytes in pending sessions. Reservation and commit checks run under a `workspaces` row lock. A commit is rejected only if it **increases** usage past the budget, so existing over-budget workspaces can still delete and shrink.     |
| Cleanup            | Blob GC adds a `deleting` tombstone so rows can be safely R2-deleted. R2 deletion applies only to rows created after migration 0033 (`r2_cleanup_eligible`). Existing rows keep today's row-only GC, and no historical bytes are removed.                                                                                                                                                                                                                                                                                              |
| Reads              | A bounded-lifetime (1 h) Revision read grant is a content token with a file-map reference served on the existing `/v/{token}/{path}` route. Multi-file pulls make one API call for the grant, plus paged listings, then content requests only.                                                                                                                                                                                                                                                                                         |
| Range              | Single `bytes=` ranges, served with correct 206 and 416 responses. Chunked files decrypt only the chunks that overlap the range. Transformed representations (gzip, noindex HTML injection) ignore `Range` and return 200.                                                                                                                                                                                                                                                                                                             |
| Caching            | `contentCacheControl` is unchanged (one-hour private freshness for static assets). ETag material becomes content-hash based when `sha256` is known, so unchanged files revalidate to 304 across Revisions.                                                                                                                                                                                                                                                                                                                             |
| Bundles            | Parent-owned guard (16 MiB buffered input). Revisions that contain any chunked file get `bundle_status = 'disabled'` with `reason: "revision_too_large"`. The large-tree download path is file-wise `pull`.                                                                                                                                                                                                                                                                                                                            |

Constants live in `packages/config/src/index.ts`:

```ts
export const MiB = 1024 * 1024;
export const GiB = 1024 * MiB;
export const MAX_FILE_BYTES = 262_144_000; // 250 MiB
export const SINGLE_PUT_MAX_BYTES = 10 * MiB; // > this => chunked-v1 required
export const LEGACY_SINGLE_PUT_MAX_BYTES = 25 * MiB; // preserve legacy Pro uploads
export const CHUNK_BYTES = 4 * MiB; // chunked-v1 fixed chunk size
export const MAX_CHUNKS_PER_FILE = Math.ceil(MAX_FILE_BYTES / CHUNK_BYTES); // 63
export const MAX_REVISION_FILES = 10_000;
export const MAX_REVISION_BYTES = 2 * GiB;
export const MAX_FILE_MAP_BYTES = 8 * MiB;
export const UPLOAD_BATCH_MAX_FILES = 1_000;
export const UPLOAD_BATCH_MAX_DELETIONS = 1_000;
export const UPLOAD_TARGETS_PAGE_MAX = 1_000;
export const FILE_LIST_PAGE_MAX = 1_000;
export const FILE_COMPLETION_BATCH_MAX_BYTES = MAX_FILE_BYTES;
export const READ_GRANT_TTL_SECONDS = 3_600;
export const REVISION_FILE_ENTRY_BYTES = 1_024;
export const STORAGE_BUDGET_BYTES_FREE = 5 * GiB;
export const STORAGE_BUDGET_BYTES_PRO = 50 * GiB;
export const REVISION_NUMBER_MAX = 2_147_483_647;
```

Plan policy (`buildPlanUsagePolicy`) for claimed workspaces: `file_size_cap_bytes:
MAX_FILE_BYTES`, `artifact_size_cap_bytes: MAX_REVISION_BYTES`, `file_count_cap:
MAX_REVISION_FILES`, `lifetime_revision_ceiling: REVISION_NUMBER_MAX`, plus the
new fields `storage_budget_bytes`, `single_put_max_bytes`, `chunk_bytes` and
`revision_file_entry_bytes`. `bundle_size_cap_bytes` is unchanged. The ephemeral
override (`EPHEMERAL_POLICY_OVERRIDES`) is applied wherever the policy is
resolved for an unclaimed workspace (`packages/db/src/policy.ts`
`usagePolicyFor`): 10 MiB per file, 25 MiB per Revision, 100 files, a ceiling of
100, and a storage budget of 100 MiB.

## 2. Formats (pure modules)

### 2.1 Transfer helpers: `packages/contracts/src/file-transfer.ts`

`api-client` depends only on `contracts`, so the shared pure helpers live here.
They use only WebCrypto, so the same code runs in Node 24 and Workers.

```ts
export const CHUNKED_FORMAT = "chunked-v1" as const;
export type ContentFormat = "single" | typeof CHUNKED_FORMAT;
export function requiresChunking(sizeBytes: number): boolean; // sizeBytes > SINGLE_PUT_MAX_BYTES
export function chunkCount(sizeBytes: number): number; // ceil(size / CHUNK_BYTES)
export function chunkSize(sizeBytes: number, index: number): number;
export type SnapshotEntry = {
  path: string;
  sha256: string | null;
  size_bytes: number;
};
export function isUnderPrefix(path: string, prefix: string | null): boolean; // prefix null => true; else path startsWith `${prefix}/`
export async function treeSnapshotDigest(
  entries: SnapshotEntry[],
  prefix: string | null,
): Promise<string>;
export const EMPTY_TREE_SNAPSHOT_SHA256: string; // treeSnapshotDigest([], null), precomputed constant + test
```

`treeSnapshotDigest` filters entries with `isUnderPrefix`, sorts them by `path`
with the default JS comparison (UTF-16 code units; never SQL `ORDER BY`), and
hashes the UTF-8 concatenation of `JSON.stringify([path, sha256, size_bytes]) +
"\n"` per entry. Prefixes are normalized `FilePath`s and match directories only:
prefix `docs` matches `docs/a.png`, not a file named `docs`.

### 2.2 Revision file map: `packages/storage/src/revision-file-map.ts`

```ts
export type RevisionFileMapEntry =
  | {
      path: string;
      size_bytes: number;
      sha256: string | null;
      content_type: string;
      format: "single";
      object_key: string;
    }
  | {
      path: string;
      size_bytes: number;
      sha256: string;
      content_type: string;
      format: "chunked-v1";
      chunk_bytes: number;
      chunks: string[];
    };
export type RevisionFileMapV1 = {
  version: 1;
  workspace_id: string;
  artifact_id: string;
  revision_id: string;
  entrypoint: string;
  files: RevisionFileMapEntry[]; // sorted by path, JS comparison, unique
};
export function serializeRevisionFileMap(map: RevisionFileMapV1): Uint8Array; // fixed key order, no whitespace
export function parseRevisionFileMap(
  bytes: Uint8Array,
  expect: { workspaceId: string; artifactId: string; revisionId: string },
): RevisionFileMapV1; // throws on any invalid field
export function lookupFileMapEntry(
  map: RevisionFileMapV1,
  path: string,
): RevisionFileMapEntry | null; // binary search
```

The parser validates the following and throws on any violation: version, IDs
equal to `expect`, sorted unique paths, `isSafePath`, single `object_key` is a
workspace blob key for the same workspace (or a revision-scoped key for this
artifact/Revision/path), chunk count equals `chunkCount(size)`, `chunk_bytes ===
CHUNK_BYTES`, and every SHA is lowercase hex. The map digest is
`sha256(serializeRevisionFileMap(map))`. It is stored with `writeWorkspaceBlob`
and read with `readWorkspaceBlobBytes`. The reader also recomputes the SHA-256
and compares it to the token digest.

### 2.3 Stored-file reads: `packages/storage/src/stored-file-reader.ts`

This is the one reader every consumer uses: content, the API file-content route
and the jobs safety scan.

```ts
export type StoredFileRef =
  | { format: "single"; objectKey: string; sizeBytes: number }
  | {
      format: "chunked-v1";
      sizeBytes: number;
      chunks: Array<{ sha256: string; sizeBytes: number }>;
    };
export function streamStoredFile(input: {
  r2: Pick<WorkspaceBlobR2, "get">;
  ring: ArtifactBytesKeyRing;
  workspaceId: string;
  file: StoredFileRef;
  range?: { start: number; endInclusive: number };
  onBytes?: (n: number) => void;
}): ReadableStream<Uint8Array>;
export async function readStoredFilePrefix(
  input: Omit<Parameters<typeof streamStoredFile>[0], "range">,
  maxBytes: number,
): Promise<Uint8Array>;
```

For chunked files the reader keeps at most two chunks in flight: the chunk being
emitted and one prefetched chunk. Each chunk is read through
`readWorkspaceBlobBytes`. A decrypted length other than the expected chunk size,
or a missing object, errors the stream (the response is aborted, never padded).
Single objects keep the current whole-object decrypt, at most 10 MiB for new
files and 25 MiB for legacy Pro files. Without a range the whole file is
streamed; with a range the reader slices.

`readWorkspaceBlobBytes` gains `maxPlaintextBytes?: number`. It rejects before
reading the body when `object.size !== ciphertextByteLengthForPlaintext(expected)`
or when the size exceeds the cap.

## 3. Persistence: migration `packages/db/migrations/0033_persistent_static_hosting.sql`

The migration is additive only. No existing row is deleted or rewritten except
the backfills noted below. Workspace RLS policies for new tables follow the
`0023_workspace_content_blobs.sql` pattern. Update `schema.ts` to match, along
with the snapshot and the local adapter state.

```sql
-- upload_sessions
alter table upload_sessions
  add column commit_guard text null check (commit_guard in ('paths','snapshot')),
  add column commit_snapshot_prefix text null,
  add column commit_snapshot_sha256 text null check (commit_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  add column pin_on_commit boolean not null default false,
  add column sealed_at timestamptz null,
  add column next_batch_index integer not null default 1;
update upload_sessions set sealed_at = created_at where sealed_at is null; -- legacy sessions are sealed
-- status values become: pending | ready | finalized | expired (ready = commit-mode finalize, awaiting publish)

-- upload_session_files
alter table upload_session_files
  add column content_format text not null default 'single' check (content_format in ('single','chunked-v1')),
  add column verified_at timestamptz null,
  add column expect_kind text null check (expect_kind in ('sha256','absent')),
  add column expect_sha256 text null,
  add column expect_size_bytes bigint null,
  add column batch_index integer not null default 0;

create table upload_session_chunks (
  workspace_id uuid not null references workspaces(id) on delete restrict,
  upload_session_id text not null,
  path text not null,
  chunk_index integer not null check (chunk_index >= 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  uploaded_at timestamptz null,
  primary key (upload_session_id, path, chunk_index),
  foreign key (upload_session_id, path) references upload_session_files(upload_session_id, path) on delete cascade
);
create index upload_session_chunks_blob_idx on upload_session_chunks (workspace_id, sha256, size_bytes);

create table upload_session_deletions (
  workspace_id uuid not null references workspaces(id) on delete restrict,
  upload_session_id text not null references upload_sessions(id) on delete cascade,
  kind text not null check (kind in ('path','prefix')),
  path text not null,
  expect_sha256 text null,
  expect_size_bytes bigint null,
  expect_snapshot_sha256 text null,
  batch_index integer not null default 0,
  primary key (upload_session_id, kind, path)
);

-- content_blobs
alter table content_blobs
  add column content_format text not null default 'single' check (content_format in ('single','chunked-v1')),
  add column gc_state text not null default 'live' check (gc_state in ('live','deleting')),
  add column gc_marked_at timestamptz null,
  add column r2_cleanup_eligible boolean not null default true;
update content_blobs set r2_cleanup_eligible = false; -- pre-existing rows: never R2-delete without approval

create table content_blob_chunks (
  workspace_id uuid not null,
  sha256 text not null,
  size_bytes bigint not null,
  chunk_index integer not null check (chunk_index >= 0),
  chunk_sha256 text not null check (chunk_sha256 ~ '^[a-f0-9]{64}$'),
  chunk_size_bytes bigint not null check (chunk_size_bytes > 0),
  primary key (workspace_id, sha256, size_bytes, chunk_index),
  foreign key (workspace_id, sha256, size_bytes) references content_blobs(workspace_id, sha256, size_bytes) on delete cascade
);
create index content_blob_chunks_chunk_idx on content_blob_chunks (workspace_id, chunk_sha256, chunk_size_bytes);

-- artifact_files / revisions / workspaces
alter table artifact_files add column content_format text not null default 'single'
  check (content_format in ('single','chunked-v1'));
create index artifact_files_legacy_bytes_idx on artifact_files (workspace_id) where storage_kind = 'revision';
alter table revisions
  add column file_map_sha256 text null check (file_map_sha256 ~ '^[a-f0-9]{64}$'),
  add column file_map_size_bytes integer null,
  add constraint revisions_file_map_pair_check check ((file_map_sha256 is null) = (file_map_size_bytes is null));
create index revisions_file_map_idx on revisions (workspace_id, file_map_sha256) where file_map_sha256 is not null;
alter table workspaces add column storage_budget_bytes bigint null check (storage_budget_bytes > 0);
```

Row conventions:

- A chunked logical file is a `content_blobs` row with `content_format =
'chunked-v1'`. Its `r2_key` is the virtual `workspaceBlobObjectKeyFor(ws,
sha256)`, and no object exists at that key. Each chunk is its own `single` row.
  `artifact_files` rows for chunked files have `storage_kind = 'blob'`, the
  virtual `r2_key`, and `content_format = 'chunked-v1'`. Every reader branches
  on `content_format` and never GETs a chunked `r2_key`; a stray GET returns
  null and fails closed.
- Physical bytes counted for a workspace: `sum(size_bytes) where content_format
= 'single'`. Chunked logical rows count 0.

## 4. Wire contracts (parent-owned, `packages/contracts`)

All new response objects are `.strict()`. Existing response schemas get only
additive optional fields, or new variants that are returned only when the
request opts in.

### 4.1 Upload sessions (`uploadSessions.ts`)

```ts
export const PathExpectation = z.union([
  z
    .object({ sha256: Sha256Hex, size_bytes: z.number().int().nonnegative() })
    .strict(),
  z.object({ absent: z.literal(true) }).strict(),
]);
export const UploadSessionChunks = z
  .object({
    chunk_bytes: z.literal(CHUNK_BYTES),
    sha256: z.array(Sha256Hex).min(1).max(MAX_CHUNKS_PER_FILE),
  })
  .strict();
// UploadSessionFileInput gains (existing fields unchanged; size_bytes max -> MAX_FILE_BYTES):
//   chunks?: UploadSessionChunks   // required iff size_bytes > SINGLE_PUT_MAX_BYTES; requires sha256; exclusive with patch
//   expect?: PathExpectation       // required iff commit.guard === "paths"; forbidden otherwise
export const UploadDeletion = z
  .object({
    path: FilePath,
    expect: z
      .object({ sha256: Sha256Hex, size_bytes: z.number().int().nonnegative() })
      .strict()
      .optional(),
  })
  .strict();
export const UploadPrefixDeletion = z
  .object({ prefix: FilePath, snapshot_sha256: Sha256Hex })
  .strict();
export const CommitSpec = z
  .object({
    guard: z.enum(["paths", "snapshot"]),
    snapshot: z
      .object({ prefix: FilePath.nullable(), sha256: Sha256Hex })
      .strict()
      .optional(), // required iff guard=snapshot
    pin: z.boolean().optional(),
  })
  .strict();
// CreateUploadSessionRequest gains:
//   commit?: CommitSpec                      // presence = guarded commit protocol
//   deletions?: UploadDeletion[] .max(1000)  // commit only
//   prefix_deletions?: UploadPrefixDeletion[] .max(100) // guard=paths only
//   more_files?: boolean                     // true => unsealed; append batches follow
//   files .max(UPLOAD_BATCH_MAX_FILES)
```

`superRefine` rules, which also apply to append batches:

- `commit` excludes `base_revision_id` and `deleted_paths`.
- `guard=snapshot` requires `snapshot`. Every file and deletion must be under
  `snapshot.prefix`. `expect` and `prefix_deletions` are forbidden.
- `guard=paths` requires `artifact_id` and `expect` on every file and deletion.
  A file may not sit under a `prefix_deletions` prefix or also appear as a
  deletion.
- `chunks.sha256.length === chunkCount(size_bytes)`.
- In a guarded session, a file with `size_bytes > SINGLE_PUT_MAX_BYTES` without `chunks` fails with
  `file_size_cap_exceeded` and the message "files over 10 MiB require chunked
  upload".
- Without `commit`, `chunks` and `expect` are forbidden. This is the legacy
  protocol. Legacy single PUTs retain their existing per-plan cap, never above
  `LEGACY_SINGLE_PUT_MAX_BYTES`.
- Paths are unique across all batches. The server enforces this at append.
- The first request may hold zero files and deletions only when `more_files`
  is true.

```ts
export const AppendUploadFilesRequest = z
  .object({
    batch_index: z.number().int().min(1), // must equal session.next_batch_index
    files: z.array(UploadSessionFileInput).max(UPLOAD_BATCH_MAX_FILES),
    deletions: z
      .array(UploadDeletion)
      .max(UPLOAD_BATCH_MAX_DELETIONS)
      .optional(),
    prefix_deletions: z.array(UploadPrefixDeletion).max(100).optional(),
    more_files: z.boolean(), // false seals the session
  })
  .strict();

export const ChunkUploadTarget = z
  .object({
    status: z.literal("chunk_upload_required"),
    path: FilePath,
    chunk_index: z.number().int().nonnegative(),
    put_url: UrlString,
    required_headers: z.record(z.string(), z.string()),
    expires_at: IsoDateTime,
  })
  .strict();
export const VerifyRequiredTarget = z
  .object({ status: z.literal("verify_required"), path: FilePath })
  .strict();
// SignedUploadTarget union gains ChunkUploadTarget and VerifyRequiredTarget (only for commit sessions).
// CreateUploadSessionResponse.files .max(2000); new optional: sealed: boolean, next_batch_index: number.
export const AppendUploadFilesResponse = z
  .object({
    upload_session_id: UploadSessionId,
    sealed: z.boolean(),
    next_batch_index: z.number().int().min(1),
    files: z.array(SignedUploadTarget).max(2000),
  })
  .strict();
export const UploadSessionTargetsResponse = z
  .object({
    upload_session_id: UploadSessionId,
    status: z.enum(["pending", "ready", "finalized", "expired"]),
    sealed: z.boolean(),
    expires_at: IsoDateTime,
    remaining: z
      .object({
        files: z.number().int(),
        chunks: z.number().int(),
        bytes: z.number().int(),
        unverified_files: z.number().int(),
      })
      .strict(),
    targets: z
      .array(
        z.union([
          UploadRequiredTarget,
          ChunkUploadTarget,
          VerifyRequiredTarget,
        ]),
      )
      .max(UPLOAD_TARGETS_PAGE_MAX),
    page_info: PageInfo,
  })
  .strict();
export const CompleteUploadFilesRequest = z
  .object({ paths: z.array(FilePath).min(1).max(64) })
  .strict(); // sum(size) <= FILE_COMPLETION_BATCH_MAX_BYTES
export const CompleteUploadFilesResponse = z
  .object({
    upload_session_id: UploadSessionId,
    files: z
      .array(
        z
          .object({
            path: FilePath,
            status: z.literal("verified"),
            sha256: Sha256Hex,
            size_bytes: z.number().int(),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();
// FinalizeUploadSessionResponse becomes a discriminated union on status:
//   existing "draft" object (unchanged; legacy sessions only)
//   { status: "ready", upload_session_id, artifact_id, revision_id, file_count: int>=0 (delta), deletion_count: int>=0 }
```

### 4.2 Publish, retention, listing, grants and usage

```ts
// revisions.ts
export const PublishRevisionRequest = z
  .object({ include_retention: z.literal(true).optional() })
  .strict();
// uploadSessions.ts: PublishResult stays .strict() and unchanged for requests without include_retention.
export const Retention = z.enum(["pinned", "temporary"]);
export const PublishResultV2 = PublishResult.extend({
  revision_number: z.number().int().positive(),
  retention: Retention,
  pinned_at: IsoDateTime.nullable(),
  effective_expires_at: IsoDateTime.nullable(),
  no_change: z.boolean(),
  changes: z
    .object({
      added: z.number().int(),
      changed: z.number().int(),
      removed: z.number().int(),
    })
    .strict(),
}).strict();

// retention.ts (new)
export const ArtifactRetention = z
  .object({
    artifact_id: ArtifactId,
    url: UrlString,
    retention: Retention,
    pinned_at: IsoDateTime.nullable(),
    expires_at: IsoDateTime,
    effective_expires_at: IsoDateTime.nullable(),
    pinned_count: z.number().int().nonnegative(),
    pin_allowance: z.number().int().positive(),
  })
  .strict();

// artifacts.ts: ArtifactSummary gains optional pinned_at, retention, effective_expires_at.
// agentView.ts: AgentViewBase gains optional file_count, files_truncated, retention, effective_expires_at.
//   files stays .max(100): entrypoint first, then by path; files_truncated=true when file_count > 100.
// AgentViewFile gains optional format: ContentFormat.

// artifactFiles.ts (new)
export const ArtifactFileListItem = z
  .object({
    path: FilePath,
    size_bytes: z.number().int().nonnegative(),
    sha256: Sha256Hex.nullable(),
    content_type: z.string().min(1).max(200),
    format: z.enum(["single", "chunked-v1"]),
  })
  .strict();
export const ArtifactFileListResponse = z
  .object({
    artifact_id: ArtifactId,
    revision_id: RevisionId,
    file_count: z.number().int(),
    size_bytes: z.number().int(),
    entrypoint: FilePath,
    title: PlainTextTitle,
    items: z.array(ArtifactFileListItem).max(FILE_LIST_PAGE_MAX),
    page_info: PageInfo,
  })
  .strict();

// readGrants.ts (new)
export const RevisionReadGrant = z
  .object({
    artifact_id: ArtifactId,
    revision_id: RevisionId,
    file_count: z.number().int(),
    size_bytes: z.number().int(),
    content_base_url: UrlString, // "{CONTENT_BASE_URL}/v/{token}/"; append encodePath(path)
    expires_at: IsoDateTime,
  })
  .strict();

// storageUsage.ts (new)
export const StorageUsage = z
  .object({
    budget_bytes: z.number().int().positive(),
    used_bytes: z.number().int(),
    reserved_bytes: z.number().int(),
    breakdown: z
      .object({
        blob_bytes: z.number().int(),
        legacy_file_bytes: z.number().int(),
        bundle_bytes: z.number().int(),
        file_entry_bytes: z.number().int(),
      })
      .strict(),
    pins: z
      .object({
        pinned_count: z.number().int(),
        pin_allowance: z.number().int(),
      })
      .strict(),
  })
  .strict();
// workspace.ts UsagePolicy gains optional storage_budget_bytes, single_put_max_bytes, chunk_bytes, revision_file_entry_bytes.
// bundle.ts BundleAvailabilityDisabled gains optional reason: z.enum(["disabled_by_policy", "revision_too_large"]) (coordinate with parent's bundle guard).
```

### 4.3 Errors

`ErrorEnvelope.error` gains optional `details: z.record(z.string(), z.unknown())`.
`getBoundResponders().respondError(code, message?, { details?, headers? })`
emits it. New codes, with statuses in `worker-runtime/src/errors.ts` and
`contracts/src/mcp/error-codes.ts`:

| Code                     | Status                             | `details`                                                                                                                                                |
| ------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commit_conflict`        | 409                                | `{ kind: "paths" \| "snapshot" \| "head", head_revision_id: string \| null, conflicts?: Array<{ path, expected, actual }> /* ≤100 */, prefix?: string }` |
| `storage_quota_exceeded` | 429 (no `Retry-After`; CLI exit 3) | `{ budget_bytes, used_bytes, reserved_bytes, required_bytes }`                                                                                           |
| `file_digest_mismatch`   | 422                                | `{ path }`                                                                                                                                               |

`storage_unavailable` with message `blob_cleanup_in_progress` and
`Retry-After: 60` covers reuse of a tombstoned blob. Existing 409 exit-code
mapping is unchanged (exit 1). Agents branch on the JSON `code`.

### 4.4 Routes (`routes/registry.*.ts`)

| Route ID                             | App    | Method and path                                                         | Auth / scope                   | Idempotency | Request → Response                                              |
| ------------------------------------ | ------ | ----------------------------------------------------------------------- | ------------------------------ | ----------- | --------------------------------------------------------------- |
| `uploadSessions.create` (existing)   | upload | `POST /v1/upload-sessions`                                              | api_key_or_mcp_oauth / publish | required    | extended request → `CreateUploadSessionResponse`                |
| `uploadSessions.appendFiles`         | upload | `POST /v1/upload-sessions/{upload_session_id}/file-batches`             | same                           | required    | `AppendUploadFilesRequest` → `AppendUploadFilesResponse`        |
| `uploadSessions.targets`             | upload | `GET /v1/upload-sessions/{upload_session_id}/targets?cursor&limit`      | same                           | none        | → `UploadSessionTargetsResponse`                                |
| `uploadSessions.completeFiles`       | upload | `POST /v1/upload-sessions/{upload_session_id}/file-completions`         | same                           | required    | `CompleteUploadFilesRequest` → `CompleteUploadFilesResponse`    |
| `uploadSessions.putFile` (existing)  | upload | `PUT /v1/upload-sessions/{id}/files/{path}?token=…`                     | signed_upload_url              | none        | chunk tokens add `ci`                                           |
| `uploadSessions.finalize` (existing) | upload | unchanged                                                               | same                           | required    | union response                                                  |
| `revisions.publish` (existing)       | api    | unchanged                                                               | publish                        | required    | `PublishRevisionRequest` → `PublishResult` or `PublishResultV2` |
| `artifacts.pin`                      | api    | `POST /v1/artifacts/{artifact_id}/pin`                                  | api_key_or_mcp_oauth / publish | required    | empty → `ArtifactRetention`                                     |
| `artifacts.unpin`                    | api    | `POST /v1/artifacts/{artifact_id}/unpin`                                | same                           | required    | empty → `ArtifactRetention`                                     |
| `artifactFiles.list`                 | api    | `GET /v1/artifacts/{artifact_id}/files?revision_id&prefix&cursor&limit` | read                           | none        | → `ArtifactFileListResponse`                                    |
| `artifacts.readGrant`                | api    | `GET /v1/artifacts/{artifact_id}/read-grant?revision_id`                | read                           | none        | → `RevisionReadGrant`                                           |
| `usage.get`                          | api    | `GET /v1/usage`                                                         | read                           | none        | → `StorageUsage`                                                |

All new API routes use `rateLimit: "actor"`. `artifact_id` accepts the same
references as `artifacts.delete`. Regenerate the OpenAPI goldens with `pnpm
openapi:write`, then validate with `pnpm openapi:check`. The managed sandbox gateway (AP-483) must allow every new path
in this table. The parent hands this list to the host owner.

### 4.5 Tokens (`packages/tokens`)

- `ContentTokenPayload` gains `file_map?: { sha256: string; size_bytes: number }`.
  The validator requires hex SHA-256 and `0 < size_bytes <= MAX_FILE_MAP_BYTES`,
  and rejects `file_map` combined with `paths`, `object_key`, `object_keys` or
  `key_prefix`.
- `SignedUploadPayload` gains `ci?: number`, an integer in 0..62. When `ci` is
  present, `sha256` is required, `size <= CHUNK_BYTES` holds, and `key` is the
  workspace blob key for `sha256`.

## 5. Server behavior

### 5.1 Session lifecycle (commit protocol)

1. **Create** (`createUploadSessionInEntities`, commit branch). Lock
   `workspaces` `FOR UPDATE`, then validate per-file caps and the batch.
   - Insert the session. `sealed_at` is now when `more_files` is not true, and
     `next_batch_index` starts at 1.
   - Insert files with `expect_*`, `content_format` and `batch_index = 0`, plus
     chunks and deletions.
   - For reuse, `findReusableAndTouch` matches only `gc_state='live'`. A whole
     file is reusable when a live row `(sha256, size)` exists in any format. Its
     `content_format` is copied, `uploaded_at` and `verified_at` are set to now,
     and the file yields `reused`.
   - Otherwise a chunked file reuses chunk rows by `(chunk_sha, chunk_size)`,
     marking them `uploaded_at = now`, and missing chunks yield
     `chunk_upload_required`. When every chunk is reused, the file yields
     `verify_required`.
   - Any requested blob row in `deleting` aborts with
     `storage_unavailable`/`blob_cleanup_in_progress`.
   - Reserve bytes (§5.5). Over budget fails with `storage_quota_exceeded`.
     Legacy (no `commit`) creates take the same lock and run the same
     reservation check, so older CLIs cannot bypass the budget.
2. **Append batch.** Requires `pending`, unsealed, unexpired, and `batch_index
=== next_batch_index`. Otherwise `invalid_request` with details `{
expected_batch_index }`. Apply the same per-batch logic, check cross-batch
   path uniqueness, check `count(files) <= file_count_cap`, then increment
   `next_batch_index`. `more_files:false` seals the session. The batch's
   idempotency replay returns the original response with fresh signatures, as
   `uploadReplay` does for create.
3. **PUT.** Single-file PUTs are unchanged. Chunk PUTs (`payload.ci`
   present) store through the same encrypt/put/verify path. The handler then
   calls `db.recordUploadedChunk({ workspaceId, sessionId, path, chunkIndex,
sha256, sizeBytes, objectKey, uploadedAt })`. That call upserts the chunk
   `content_blobs` row (`on conflict ... do update ... where
content_blobs.gc_state = 'live'`; a deleting conflict throws
   `blob_cleanup_in_progress`) and sets `upload_session_chunks.uploaded_at`.
   Reduce `put.ts` copies so peak memory is about 3× the body: hash `plaintext`
   directly and pass `encrypted.ciphertext` to `put` without `Uint8Array.from`.
4. **Targets.** Pages are ordered by `(path, chunk_index)`. The handler signs
   fresh PUT URLs (`signUploadUrl`) for files and chunks with `uploaded_at` null
   and lists `verify_required` for chunked files whose chunks are all uploaded
   but whose `verified_at` is null. This is the resume and grant-renewal path.
5. **Complete files.** For each path, which must be chunked, belong to the
   session, have all chunks uploaded, and have `verified_at` null (an already
   verified file returns its stored result):

   - Stream the chunks in order through `readWorkspaceBlobBytes`, checking each
     decrypted length against `chunkSize`.
   - Feed `createHash("sha256")` from `node:crypto`, with one chunk prefetched.
   - Compare the digest and length against the declared values. A mismatch
     fails with `file_digest_mismatch`.
   - In one transaction, upsert the logical `content_blobs` row (`chunked-v1`,
     virtual key), insert `content_blob_chunks` (`on conflict do nothing`), and
     set `verified_at`.

   This lives in a new file, `apps/upload/src/complete-files.ts`.

6. **Finalize (commit session).** Requires `sealed_at` set, every single file
   uploaded, every chunked file verified, and no HEAD-per-file. Commit sessions
   trust the DB `uploaded_at`/`verified_at`, which the Worker sets only after a
   successful R2 write. `observeUploadSessionForFinalize` keeps its HEAD checks
   for legacy sessions only. Run patch reconstruction (existing
   `revisionReconstructor`). Each patched file's result blob replaces the
   placeholder row in the session (`sha256 = result_sha256`, `storage_kind =
'blob'`). The file's `expect` must equal `patch.base_sha256` with the base
   size. Set `status='ready'` and return the `ready` variant. Replays return the
   same object.
7. **Expiry.** The upload cleanup sweep expires `pending` and `ready` sessions
   whose `expires_at` has passed. Chunk and blob bytes are reclaimed only by
   blob GC.

### 5.2 Guarded commit (`publishRevision`, ready-session branch)

`packages/db/src/repository/workflows/commit-workflow.ts` (new) owns this. It is
invoked from `publishRevision` when no Revision row exists for `revisionId` and
`uploadSessions.findByRevisionId` returns a `ready` session for this workspace
and artifact. Everything below runs inside the existing `uow.command`
(`artifact.revision.publish`):

1. Lock `workspaces` `FOR UPDATE`. If the artifact exists, lock it with the new
   `artifacts.lockForCommit(id, ws)` (`select … for update`) and require it to
   be `active`. If the artifact row is absent, the commit creates it, which
   requires `guard=snapshot` with prefix null and `EMPTY_TREE_SNAPSHOT_SHA256`.
2. Read the head tree, `artifactFiles.listForArtifact(head)`, which is empty
   when there is no head.
3. Evaluate the guard and collect up to 100 conflicts:
   - `snapshot`: `treeSnapshotDigest(head, prefix) === snapshot.sha256`;
     otherwise `commit_conflict{kind:"snapshot", prefix}`.
   - `paths`: each file or deletion `expect` is compared with the head row by
     `sha256` and `size_bytes`. Absent means the path is not present. A head row
     with null `sha256` never matches a sha expectation. Each prefix deletion
     checks the snapshot over head under that prefix. Mismatches yield
     `commit_conflict{kind:"paths", conflicts}`.
4. Merge: start from head, remove deletions, remove all head paths under prefix
   deletions, then upsert session files. Inherited rows must be `storage_kind =
'blob'`. Under `guard=paths`, a legacy revision-scoped head row that would be
   inherited fails `invalid_request` with detail
   `inherited_path_not_blob_backed` (the CLI reacts by mirroring the whole
   tree). Under `snapshot` with prefix null, every head row is either replaced
   or deleted by construction. The client must list every remaining path, so
   legacy rows are never inherited in that case.
5. Validate the merged tree: entrypoint present, file count ≤ cap, total ≤
   Revision cap, and `revision_number <= lifetime_revision_ceiling`.
6. No-op check: same `(path, sha256, size_bytes, content_format, content_type)`
   set, same entrypoint, same title, and `pin_on_commit` already satisfied. In
   that case mark the session `finalized` and return the head result with
   `no_change: true`, consuming no allowance.
7. Quota (§5.5). The commit is rejected when `used + entry bytes(merged) +
map bytes` exceeds the budget **and** exceeds current used.
8. Write: insert artifact if new, insert the Revision as `published` with the
   next number and `parent = head`, insert merged `artifact_files` (batches of
   1,000), and set the bundle status. Bundle status is `disabled` when any file
   is chunked or total plaintext exceeds the parent's bundle input cap;
   otherwise it follows existing policy.
9. Build and write the file map through the new port `ctx.options.fileMapStore.write(map) →
{sha256, size_bytes, r2_key}` (implemented in API with `writeWorkspaceBlob`).
   Upsert its `content_blobs` row, set `revisions.file_map_*`, and update the
   artifact head (`updatePublished`, with `expiresAt` per existing rules).
10. If `pin_on_commit` is set, call `tryPinUnderCap`. `pinned_artifact_cap_exceeded`
    rolls back the whole commit.
11. Write audit events `artifact.published` (+`artifact.created`,
    `artifact.pinned` when applicable) and mark the session `finalized`. The
    result includes `file_map: {sha256, size_bytes}` (replacing
    `file_object_keys` for this Revision), `changes`, `no_change`, and
    retention.

Legacy `publishRevision` (draft path) also builds and writes a file map for
every newly published Revision, applies the step 7 quota check, and adds the
head check from §1. The API signer
(`signPublishResult`, `signAgentViewContentUrls`) mints `file_map` tokens when
the Revision has a map and keeps today's `object_keys`/`object_key` tokens for
older Revisions.

`peekPublishWriteGate` handles a ready session: `is_new_artifact = artifact row
absent`. The publish coordinator flow (allowance, fanout, capability manifest)
is otherwise unchanged. Fanout is skipped for `no_change`.

### 5.3 Retention

`packages/db/src/repository/workflows/artifact-retention-workflow.ts` (new)
exports `setArtifactRetention(ctx, { actor, idempotencyKey, artifactId, pinned:
boolean, operation, now })`.

- `actor.type` may be `member` or `api_key`.
- An unclaimed workspace fails `forbidden`.
- `pinned:true` uses `tryPinUnderCap`. `pinned:false` clears `pinned_at` and
  sets `expires_at = now + policy.default_ttl_seconds`.
- Both bump `updated_at` (so the capability manifest rewrites) and record the
  existing audit actions.
- Operations: web uses `web.artifact.pin`/`web.artifact.unpin`, and agents use
  `artifact.pin`/`artifact.unpin`.
- `pinWebArtifact`/`unpinWebArtifact` delegate to this function.

The API handler runs the command and then refreshes the capability manifest via
the existing `refreshCapabilityManifest` path. It returns 200 only after the
manifest write succeeds; a failed write returns `storage_unavailable`, and a
retry with the same key replays the DB result and re-refreshes. Response:
`ArtifactRetention`, with `effective_expires_at = pinned ? null : expires_at`.

### 5.4 Content serving (`apps/content`)

- **Map tokens.** Load the map with `readWorkspaceBlobBytes(ws, file_map.sha256,
maxPlaintextBytes)`, verify the SHA-256, call `parseRevisionFileMap` with the
  token IDs, and cache it in an isolate LRU keyed by digest with a 16 MiB
  serialized budget. `lookupFileMapEntry(path)` returns null for unknown paths,
  which become 404. Denylist, lockdown and per-artifact rate limits apply
  exactly as today.
- **Headers.** Content type, CSP, cache control, noindex and opaque-origin CORS
  are unchanged.
- **ETag.** `contentEtag` material is `sha256:{sha}\n{size}\n{path}\n{representation}`
  when `sha256` is known. Legacy material is `(revision_id, path, representation)`.
- **Range** (GET only, identity representation only):
  - Parse a single `bytes=a-b`, `a-` or `-n` range. Multiple ranges or an
    unparseable header yield a 200 full response. An unsatisfiable range
    yields 416 with `Content-Range: bytes */{size}`.
  - `If-Range` requires a strong ETag match; otherwise return 200.
  - A satisfied range returns 206 with `Content-Range` and `Content-Length`.
  - Range-eligible 200 and 206 responses add `Accept-Ranges: bytes`.
  - Gzip-negotiated and noindex-transformed HTML responses ignore Range.
- **Chunked files.** These are always served with identity encoding (no gzip)
  and streamed through `streamStoredFile`. HEAD reports the size from the map.
  Read events count the bytes actually streamed.
- **Single files.** Unchanged, plus range slicing.

### 5.5 Storage accounting (`packages/db/src/queries/storage-usage.ts`, new)

```text
used = Σ content_blobs.size_bytes where workspace_id=$ws and content_format='single'
     + Σ artifact_files.size_bytes where storage_kind='revision' and revision in (draft,published) and artifact active
     + Σ revisions.bundle_size_bytes where bundle_status='ready' and revision live and artifact active
     + REVISION_FILE_ENTRY_BYTES × Σ revisions.file_count where status in ('draft','published') and artifact active
reserved = Σ upload_session_files.size_bytes (single, uploaded_at null) + Σ upload_session_chunks.size_bytes (uploaded_at null)
           over sessions with status in ('pending','ready') and expires_at > now
budget = workspaces.storage_budget_bytes ?? policy.storage_budget_bytes
```

The checks run under the `workspaces` row lock. `usage.get` returns the same
numbers. Rows that are unreferenced but not yet GC'd still count until the
hourly GC removes them. `docs/specs` documents that delay: up to the 24 h GC age
floor plus one sweep.

### 5.6 Blob GC and R2 cleanup (`apps/jobs`, `packages/db/src/queries/content-blobs.ts`)

The jobs sweep must call the repository implementation. Delete the duplicate raw
SQL in `apps/jobs/src/discovery/content-blob-gc.ts`, which lacks the age floor.
A row is **referenced** if any of the following holds:

1. A blob `artifact_files` row with the same `(ws, sha256, size)` exists in a
   `draft` or `published` Revision of an active artifact.
2. A blob `upload_session_files` row with the same key belongs to a `pending`
   or `ready`, unexpired session.
3. An `upload_session_chunks` row with the same key belongs to such a session.
4. A `content_blob_chunks` row exists whose `(chunk_sha256, chunk_size_bytes)`
   matches and whose parent row is `live`.
5. A `revisions` row has `file_map_sha256`/`file_map_size_bytes` equal to the
   key, is `draft` or `published`, and belongs to an active artifact.

Sweep:

1. Mark: `update … set gc_state='deleting', gc_marked_at=now where gc_state='live'
and not referenced and updated_at < now − 24h … limit 500 returning`. The
   reuse touch takes the same row lock, and Postgres EvalPlanQual re-checks
   `updated_at`, so a concurrent reuse wins.
2. For marked rows with `content_format='single' and r2_cleanup_eligible`,
   delete the R2 keys in batches of ≤1,000.
3. Delete the marked rows. Logical chunked rows cascade to
   `content_blob_chunks`, and their chunks become unreferenced on a later sweep.
4. Rows still in `deleting` from an interrupted sweep are retried first.

Rows with `r2_cleanup_eligible = false` keep today's row-only deletion. Their
bytes are left in place.

## 6. Clients

### 6.1 Shared engine (`packages/api-client`)

The new files are `publish-plan.ts`, `publish-commit.ts`, `chunked-upload.ts`,
`pull-plan.ts`, `pull-transfer.ts` and `transfer-retry.ts`. `runPublish` keeps
its export name and is rewritten to the commit protocol. The legacy draft path
is removed from the client.

```ts
export type LocalSource = {
  path: string; // remote path
  sizeBytes: number;
  sha256: Sha256Hex;
  chunkSha256?: Sha256Hex[]; // present iff requiresChunking(sizeBytes)
  contentType: string;
  readRange(start: number, length: number): Promise<Uint8Array>; // implementations verify bytes against recorded digests
  patch?: PublishFilePatch; // MCP multi_edit / CLI edit only
};
export type PublishPlanInput = {
  artifactId?: ArtifactReference;
  title: PlainTextTitle;
  entrypoint?: string;
  sources: LocalSource[]; // the local selection, already mapped to remote paths
  mode:
    | { kind: "tree" }
    | { kind: "paths" }
    | { kind: "mirror_prefix"; prefix: string };
  deletePaths?: string[]; // paths mode; a remote directory becomes a prefix deletion
  pin?: boolean;
  dryRun?: boolean;
  idempotencyKey: IdempotencyKey;
  onProgress?: (p: TransferProgress) => void;
};
export type PublishPlan = {
  commit: CommitSpec;
  upserts: LocalSource[];
  deletions: UploadDeletion[];
  prefixDeletions: UploadPrefixDeletion[];
  unchanged: number;
  headRevisionId: string | null;
  bytesToSendMax: number;
  noChange: boolean;
};
export async function planPublish(
  t: PublishTransport,
  input: PublishPlanInput,
): Promise<PublishPlan>;
export async function executePublish(
  t: PublishTransport,
  plan: PublishPlan,
  input: PublishPlanInput,
): Promise<PublishOutcome>;
```

**Plan.** Page `artifactFiles.list` for head, pinning `revision_id` from the
first page. For `tree` mode, build a snapshot guard (prefix null, head
snapshot), list only changed or added sources, and turn remote-only paths into
deletions. `mirror_prefix` does the same scoped to the prefix. `paths` mode
puts an expectation on every upsert and deletion; a deletion naming a remote
directory becomes a prefix deletion with that prefix's snapshot. A new artifact
uses a snapshot guard against the empty tree with everything as upserts.

**Execute.**

1. Create the session, then append batches of ≤1,000 entries (files plus
   deletions).
2. Upload single files and chunks with six transfers in flight.
3. Complete chunked files in byte-bounded batches.
4. On an expired URL or interruption, use `targets` to resume.
5. Finalize, then publish with `{ include_retention: true }`.

**Retries.** Up to 5 attempts with jittered backoff. On 429, honor
`Retry-After`. The same idempotency key is reused per operation, with keys
derived as `${baseKey}:b${index}`, `${baseKey}:c${n}` and `${baseKey}:f`, and
hashed to fit the key format. 4xx responses are never retried except 409
`idempotency_in_flight`.

**Conflicts.** `commit_conflict` surfaces with its details and is never retried
automatically.

**Pull.** Exports `pullPlan` and `pullFiles`:

1. Fetch the read grant, then page the listing for the selected paths and
   prefixes against the grant's `revision_id`.
2. For each file: skip it if the local file exists with matching sha256. If it
   exists and differs, record a conflict and stop before writing unless
   `overwrite`.
3. Download to `${target}.agent-paste-partial`, resuming with `Range` from the
   partial file's length and `If-Range` set to the ETag.
4. Verify size and sha256, then atomically rename.
5. Refresh the grant for the same `revision_id` on 401/403/404 after expiry, and
   honor 429 `Retry-After`.
6. Use six files in flight.

### 6.2 CLI (`apps/cli`)

Commands and flags (add to `COMMAND_FLAG_NAMES`, help, and `cli.md`):

| Command                                                                                | Behavior                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publish <path>`                                                                       | New artifact: whole tree. With `--artifact-id`: whole-tree mirror under a snapshot guard (same visible result as today, now concurrency-safe).                                                                              |
| `publish <path> --artifact-id <ref> --to <remote-path>`                                | Partial upload: a file maps to a remote file path, a directory to a remote prefix. Patch mode with per-path guards. Never deletes.                                                                                          |
| `… --to <remote-dir> --mirror`                                                         | Scoped mirror of a prefix. Remote files under it that are absent locally are deleted. Snapshot-guarded.                                                                                                                     |
| `publish [<path>] --artifact-id <ref> --delete <remote-path>` (repeatable)             | Explicit file or prefix deletion with guards. May be combined with `--to` or used alone.                                                                                                                                    |
| `--pin`                                                                                | Pin intent committed with the publish.                                                                                                                                                                                      |
| `--dry-run`                                                                            | Print the plan without creating a session: `{ mode, head_revision_id, added, changed, removed, unchanged, bytes_to_send_max, limits, usage }`.                                                                              |
| `--exclude <glob>` (repeatable)                                                        | Node 24 `path.matchesGlob` against the local relative path, applied after the fixed exclusions. The path argument is the include selection.                                                                                 |
| `pin <ref>` / `unpin <ref>`                                                            | `ArtifactRetention` output.                                                                                                                                                                                                 |
| `list [--cursor <c>]`                                                                  | Artifacts with retention fields.                                                                                                                                                                                            |
| `delete <ref> --yes`                                                                   | Existing delete route. Without `--yes` the command fails with exit 4.                                                                                                                                                       |
| `pull <ref> <remote-path>`                                                             | Unchanged single-file cat or JSON behavior.                                                                                                                                                                                 |
| `pull <ref> [<remote-path>…] --output <dir> [--revision-id] [--overwrite] [--dry-run]` | File-wise directory or binary download. No remote path means the whole tree. Selections may be files or prefixes. Local files outside the selection are never touched. Writes go through `root.openWritable` under `<dir>`. |
| `download`                                                                             | Unchanged. For `disabled` with `revision_too_large`, the message suggests `pull --output`.                                                                                                                                  |

**Local scan** (`apps/cli/src/local-scan.ts`, new; it replaces the
buffer-everything path in `local.ts` and `publish-preflight.ts`). Walk and
symlink rules are unchanged. Each file is opened through `root.open` (a pinned
`FileHandle`) and read in 4 MiB blocks to compute the whole-file SHA-256 and,
when chunking applies, the chunk digests. Only metadata is retained. At upload,
`readRange` reopens through the root, reads the range, and re-hashes it; a
mismatch fails with `local_file_changed` (exit 1), and nothing is committed.
`fs-safe` `maxBytes` becomes `MAX_FILE_BYTES`.

**Removed.** `manifest-cache.ts` and the directory-publish patch generation in
`revise.ts` go away, because head listing replaces the cache. `edit` keeps
patches through a commit with a `paths` guard whose `expect` is the base
SHA-256.

**JSON output.** `publish --json` adds `mode`, `no_change`, `retention`,
`effective_expires_at` and `changes` within schema version `"2"`. Errors carry
`details` in the error envelope.

All new command modules are separate files (`pin.ts`, `list.ts`,
`delete.ts`, `pull-dir.ts`). `index.ts` only dispatches.

### 6.3 MCP (`apps/mcp`, `contracts/src/mcp/*`)

- `publish_artifact`, `add_revision` and `multi_edit` call the commit protocol
  through `runPublish`:
  - `add_revision`: `paths` guard with `expect` from the agent view's file
    `sha256`.
  - `multi_edit`: patch, with `expect` equal to the base SHA-256.
  - `publish_artifact`: empty-tree snapshot.
- `publish_artifact` and `add_revision` accept optional `pin: boolean`.
- New tools `pin_artifact` and `unpin_artifact` forward to `artifacts.pin` and
  `artifacts.unpin`, with `requiredScopes: ["publish"]`.
- `list_artifacts` and `read_artifact` pass through the new optional fields.
- MCP never uses chunked uploads. Its payloads stay ≤ 10 MiB.

The explicit CLI `edit` workflow keeps its text-patch behavior. Directory sync
uses the remote manifest and file transfers without removing that edit path.

## 7. Ownership and sequencing

### Phase 0: parent, before spawning (shared contract files)

These are mechanical from §1–§4. Land them as one commit so workers start from
compiling types:

- `packages/config/src/index.ts`
- `packages/contracts/src/{file-transfer.ts (new), uploadSessions.ts, revisions.ts, retention.ts (new), artifactFiles.ts (new), readGrants.ts (new), storageUsage.ts (new), artifacts.ts, agentView.ts, workspace.ts, common.ts, bundle.ts, index.ts}`
- `packages/contracts/src/routes/{registry.storage.ts, registry.artifacts.ts, registry.actor.ts, request-schemas.ts}`
- `packages/contracts/src/mcp/{error-codes.ts, registry.ts, tool-schemas.ts}`
- OpenAPI goldens
- `packages/worker-runtime/src/{errors.ts, route-repository-errors.ts}` plus responder `details` support
- `packages/tokens/src/{content.ts, upload-url.ts}`
- `packages/storage/src/revision-file-map.ts` (new, pure)
- `packages/db/migrations/0033_persistent_static_hosting.sql`, `packages/db/src/schema.ts`
- `packages/db/src/repository/{interface.ts, ports.ts}`: signatures only, with stubs that throw `not_implemented` in `core.ts`

Repository signatures (Phase 0 stubs, implemented by W1):

```ts
appendUploadFiles(input: { actor; idempotencyKey; sessionId; request: AppendUploadFilesRequest; now }): Promise<UploadSessionRecord /* batch view */>;
listUploadTargets(input: { actor; sessionId; cursor?: string; limit: number; now }): Promise<UploadTargetsPage>;
recordUploadedChunk(input: { workspaceId; sessionId; path; chunkIndex; sha256; sizeBytes; objectKey; uploadedAt }): Promise<void>;
getChunkedFileForCompletion(input: { actor; sessionId; path }): Promise<{ sizeBytes; sha256; chunks: Array<{ sha256; sizeBytes; uploaded: boolean }>; verifiedAt: string | null } | null>;
recordChunkedFileVerified(input: { actor; sessionId; path; now }): Promise<void>;
setArtifactRetention(input: { actor; idempotencyKey; artifactId; pinned: boolean; operation: "artifact.pin" | "artifact.unpin" | "web.artifact.pin" | "web.artifact.unpin"; now: string }): Promise<RetentionView>;
listArtifactFiles(input: { actor; artifactId; revisionId?: string; prefix?: string; cursor?: string; limit: number }): Promise<ArtifactFileListPage | null>;
getRevisionReadTarget(input: { actor; artifactId; revisionId?: string }): Promise<{ artifactId; revisionId; workspaceId; fileMap: { sha256; size_bytes } | null; objectKeys: Record<string, string> | null; fileCount; sizeBytes; ephemeralTier: boolean } | null>;
getStorageUsage(input: { actor; now }): Promise<StorageUsage>;
// RepositoryOptions gains fileMapStore?: { write(map: RevisionFileMapV1): Promise<{ sha256: string; size_bytes: number; r2_key: string }> }
```

### W1: server write path and lifecycle (GPT-6.1 Sol, xhigh)

Owns:

- `packages/db/src/**` except the Phase 0 files above, including: queries,
  `upload-session-lifecycle.ts`, new `commit-workflow.ts`,
  `artifact-retention-workflow.ts`, `storage-usage.ts`, `policy.ts`,
  local-adapter parity, `web-dashboard-workflow.ts` pin delegation,
  `content-blobs.ts` GC, and legacy-publish file map and head check.
- `apps/upload/src/**`: create, new `append-files.ts`, `targets.ts` and
  `complete-files.ts`, `put.ts` chunk branch, `finalize.ts`, and the index
  mounts.
- `apps/jobs/src/discovery/{content-blob-gc.ts, upload-cleanup.ts}`.
- `apps/jobs/src/handlers/safety-scan-files.ts`: skip chunked files with an
  op-log entry.
- Specs: `docs/specs/data-model.md`, `docs/specs/jobs.md`.

Tests:

- Postgres tests for the commit guards: disjoint `paths` commits both succeed;
  overlapping commits conflict; a snapshot race against a concurrent add under
  the prefix conflicts; a prefix deletion racing an added descendant conflicts.
- Atomic rollback on a cap failure.
- No-op.
- Quota reservation under two concurrent sessions.
- GC tombstone versus concurrent reuse.
- `r2_cleanup_eligible=false` rows are never R2-deleted.
- Chunk record and complete, including a digest mismatch.
- Batch ordering.
- Legacy draft head check.
- Unpin fresh retention.

### W2: API, content serving, storage reader (GPT-6.1 Sol, xhigh)

Owns:

- `apps/api/src/**`:
  - routes for pin, unpin, files list, read grant and usage;
  - `signPublishResult`/`signAgentViewContentUrls` `file_map` tokens;
  - `include_retention` result shaping in the publish route;
  - the `fileMapStore` implementation and its wiring into the API repository
    options;
  - file-content support for chunked files (`readStoredFilePrefix` of chunk 0;
    `is_binary` from a streaming UTF-8 check; no body).
- `apps/content/src/**`: map resolution and cache, Range, ETag, chunked
  streaming.
- `packages/storage/src/{stored-file-reader.ts (new), workspace-blob-bytes.ts}`.
- Specs: `docs/specs/api.md`, `docs/specs/content-rendering.md`.

Tests:

- Range table: 206, 416, `If-Range`, multi-range → 200, gzip/noindex ignoring
  Range, HEAD.
- Chunked stream with a corrupt or missing chunk aborts.
- Map digest mismatch → 404.
- Unknown path → 404.
- Denylisted Revision → 404 on a map token.
- Pin refresh writes `exp:null`. Unpin writes the new expiry.
- Read grant expiry.
- Legacy `object_keys` tokens still serve.
- ETag stable across Revisions for unchanged content.

### W3: clients (GPT-6.1 Sol, high)

Owns:

- `packages/api-client/src/**`
- `apps/cli/src/**`
- `apps/mcp/src/**`
- `packages/revise-core` if `edit` plumbing needs it
- `scripts/transfer-soak.mjs` (new; see §8)
- Specs and docs: `docs/specs/cli.md`, the `README.md` CLI sections, and public
  agent instructions in `apps/apex` (`/agents.md`, `/llms.txt` sources)

Tests:

- Plan computation for each mode.
- Batch and idempotency key derivation.
- Resume from `targets` after a simulated kill.
- `local_file_changed`.
- Pull: overwrite protection, partial resume, hash failure deletes the partial
  file, and one Revision across a concurrent publish.
- Flag validation.
- MCP pin tools and `add_revision` guard conflict mapping.

W3 codes against the Phase 0 contracts and a local repository harness. End-to-end
work waits for W1 and W2.

### Parent integration (after workers)

- `docs/specs/features.md`
- `docs/ops/project-status.md`
- ADR amendments 0041, 0048, 0056, 0063, 0089 and 0094, plus a new ADR for
  chunked-v1 and the file map
- Bundle guard reason wiring with the W1 `bundle_status` rule
- The gateway route list for AP-483
- Merge order: Phase 0 → W1 → W2 → W3 → integration

Conflicts in `packages/db/src/repository/core.ts` (W1) and app `index.ts` mounts
(W1 upload, W2 api) are expected to be trivial. W1 must not edit `apps/api`, and
W2 must not edit `packages/db`. If W2 needs a DB change, it requests it from the
parent.

## 8. End-to-end acceptance (preview)

Run against a preview deployment with real R2, Postgres and the managed CLI
gateway. Production stays an explicit approval step. Record results in the PR.

1. **Large file.** A 262,144,000-byte incompressible file publishes. Then:
   - a 262,144,001-byte file fails client-side and is rejected server-side
     before any chunk is signed;
   - serve, GET, Range and `pull --output` round-trip the file with a matching
     sha256.
2. **Aggregate size.** Two trees publish and `pull --output` round-trips with
   identical hashes: ≥ 1 GiB of 8,000 small files, and ≥ 1 GiB of 4 × 250 MiB
   plus 200 small files.
3. **Upload resume.** Kill the CLI mid-upload of a 250 MiB file and re-run it.
   Already-uploaded chunks are not resent (assert from `upload_stats` and
   server logs). Expire the URLs (shorten `UPLOAD_URL_TTL_SECONDS` on preview)
   and confirm `targets` renews them.
4. **Pull resume.** Kill the pull mid-download and re-run it. The partial file
   resumes with Range and verifies.
5. **No-op.** Re-running an unchanged publish sends no bytes and creates no
   Revision (`no_change: true`, revision count unchanged).
6. **Concurrency.** Two machines run concurrent `--to` updates on disjoint
   paths; both survive. Overlapping updates produce `commit_conflict` with
   paths. A scoped mirror racing an add under its prefix conflicts. Unselected
   remote paths keep their exact bytes.
7. **Updates.** The same Artifact accepts 150 publishes, and the URL is
   unchanged.
8. **Retention.** `publish --pin`, then `unpin`: `effective_expires_at` is a
   fresh window, and `pin` restores `exp:null` in the capability manifest. A
   pinned Artifact is still served after its former expiry time. The parent may
   force this check on preview by setting `expires_at` in the past through an
   operator route or SQL on the preview database.
9. **Quota.** Set the preview workspace `storage_budget_bytes` to 1.5 GiB.
   Concurrent sessions cannot jointly exceed it, and deleting an Artifact frees
   usage after GC.
10. **Bundles.** A revision with a chunked file reports `bundle.status:
"disabled"` with `reason: "revision_too_large"`. A small revision still
    produces a ZIP.
11. **Memory.** `scripts/transfer-soak.mjs` records CLI peak RSS (≤ 400 MiB for
    the publish and pull runs) and runs three 250 MiB publishes and pulls
    concurrently. Workers analytics for upload, api and content show no
    `exceededMemory` or `exceededCpu` outcomes during the soak.
12. **Browser.** An image-heavy static site (≥ 2,000 assets) loads at the
    capability URL, and HTML updates on reload. Static assets keep the one-hour
    `max-age` policy and return 304 on revalidation across Revisions for
    unchanged files.
13. **Repo checks.** `pnpm verify`, `pnpm openapi:check` and the focused
    package tests pass. An independent review (sbx-pr-review) is done.

## 9. Done

- Every acceptance item in §8 passes on preview, with evidence linked in the PR.
- Specs, README and agent instructions describe the shipped behavior. ADRs are
  amended, and the proposal is marked superseded by this contract.
- No existing Revision, Artifact or R2 object was deleted by the migration or
  rollout. Pre-0033 blob rows keep `r2_cleanup_eligible = false`.
- A production deploy is presented to Isaac with the preview evidence and the
  AP-483 gateway route list, and is not performed without approval.
