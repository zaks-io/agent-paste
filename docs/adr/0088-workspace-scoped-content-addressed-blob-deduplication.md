# Workspace-Scoped Content-Addressed Blob Deduplication

Status: Accepted (retroactive). Records a decision already shipped in code and
[`data-model.md`](../specs/data-model.md)/[`api.md`](../specs/api.md) but not
previously captured as an ADR. Drafted because the next decision
([ADR 0089](./0089-revision-commit-chain-tree-inheritance-and-server-reconstructed-delta.md))
builds directly on it and an implementer should not have to reconstruct this from
the schema and commit history.

A **Revision** is "a complete immutable file tree." Re-publishing an **Artifact**
with one changed file used to re-upload every file's bytes, even the unchanged
ones, because every file was stored under a per-Revision R2 key
(`artifacts/{artifactId}/revisions/{revisionId}/files/{path}`). For an Artifact
carrying a multi-megabyte asset that the agent edits around, the same bytes were
written to R2 again on every Revision.

## Decision

Files are deduplicated within a **Workspace** by the SHA-256 of their plaintext.

- The client sends a manifest of `(path, size_bytes, sha256)` in
  `CreateUploadSessionRequest`. `sha256` is the lowercase hex digest of the
  plaintext, computed client-side (the CLI streams it via `sha256HexForFile`).
- A `content_blobs(workspace_id, sha256, size_bytes)` row records a verified
  blob and its shared R2 key
  `workspaces/{workspaceId}/blobs/sha256/{prefix}/{sha256}`
  (`workspaceBlobObjectKeyFor`). The key is deterministic, so two concurrent
  uploads of the same bytes target the same object.
- On upload-session create, a file whose `(workspace_id, sha256, size_bytes)`
  already has a blob is marked `storage_kind = 'blob'` with `uploaded_at` set
  immediately, and the wire response returns `reused` instead of an
  `upload_required` PUT URL. The client skips the PUT. Same-session duplicate
  hashes require exactly one PUT; the rest are `reused`.
- The upload Worker verifies the plaintext digest on PUT (the signed token
  carries the expected `sha256`; a mismatch fails the PUT) before
  `content_blobs.upsert` records the blob. The digest is never trusted without
  verification.
- Blobs are encrypted exactly like Revision files under the per-Workspace DEK
  ([ADR 0063](./0063-application-layer-encryption-for-artifact-bytes.md)), but
  with a distinct AAD version `v2 = (workspaceId, sha256)` that omits
  `artifactId`/`revisionId`/`path`, so one stored object is legitimately
  reusable across Revisions and Artifacts inside the Workspace.
- `sha256` is optional for compatibility. A client that omits it keeps the
  legacy per-Revision object path (`storage_kind = 'revision'`) and does not
  participate in dedup. There is no backfill of historical revision-key objects.

## Considered Options

- **No dedup; full re-upload every Revision (status quo before this).**
  Rejected. Re-uploading unchanged multi-megabyte assets is wasted bandwidth and
  R2 writes on the common "edit around one big file" agent workflow.
- **Platform-wide (global) blob dedup.** Rejected. A single global content pool
  maximizes dedup but breaks tenant isolation: a blob's existence becomes an
  oracle for "some other Workspace uploaded these exact bytes," and the encryption
  blast radius widens past the **Workspace** boundary that is already the access
  boundary ([ADR 0063](./0063-application-layer-encryption-for-artifact-bytes.md)).
  Workspace-scoped dedup keeps the tenant boundary intact for the cost of missing
  cross-tenant duplicates, which are not a real workload.
- **Server-computed digests.** Rejected. Hashing on the server means the bytes
  must transit before the dedup decision, which defeats the point (skip the
  upload). The client computes the digest; the server verifies it on the PUT it
  does receive.
- **Workspace-scoped dedup (chosen).** Dedup where the bytes already live behind
  the same access and encryption boundary, decided before upload from a
  client-supplied digest, verified on write.

## Consequences

- **Unchanged files already skip re-upload across Revisions** — but only when the
  client re-declares them with their `sha256`. The dedup saves the bytes on the
  wire; it does not remove the requirement to re-enumerate the full file list, and
  the system does not detect unchanged files on its own. Closing that gap is
  [ADR 0089](./0089-revision-commit-chain-tree-inheritance-and-server-reconstructed-delta.md).
- **Two storage kinds coexist.** `artifact_files.storage_kind` is `blob`
  (shared workspace object) or `revision` (legacy per-Revision object). Byte
  purge, bundle generation, and content serving treat both transparently.
- **GC is reference-counted and conservative.** A `jobs`-owned sweep deletes
  unreferenced `content_blobs` rows after checking active Artifacts and live
  pending upload sessions, but does **not** delete the deterministic shared R2
  object, so a concurrent verified upload cannot be de-indexed and then have its
  freshly written bytes removed by a delayed delete.
- **Encryption is unchanged in substance.** Blobs use the same algorithm, DEK
  derivation, and rotation as Revision files; only the AAD composition differs so
  the object is path/revision-independent.
- **No new domain vocabulary.** A blob is an implementation property of how a
  **Revision** file is stored; [`CONTEXT.md`](../../CONTEXT.md) does not gain a
  "blob" term.

## What this ADR is not

- Not intra-file deduplication. The unit is the whole file; one changed byte
  yields a new digest and a new blob. Sub-file delta is
  [ADR 0089](./0089-revision-commit-chain-tree-inheritance-and-server-reconstructed-delta.md).
- Not a Revision-level content address or commit graph. Only individual files are
  content-addressed; Revisions remain a flat numbered list until
  [ADR 0089](./0089-revision-commit-chain-tree-inheritance-and-server-reconstructed-delta.md).
