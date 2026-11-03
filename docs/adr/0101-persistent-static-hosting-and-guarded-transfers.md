# Persistent static hosting and guarded transfers

Status: Accepted for implementation. Production rollout requires separate approval.

## Context

Stable Artifact URLs and existing pinning can support general static hosting.
The earlier transient-only product boundary, small file caps, embedded token
file lists, and unguarded parent-tree replacement prevent reliable agent sync.
Directories around 1 GiB and individual files up to 250 MiB must fit within
Workers' memory limits. Partial transfer means both selecting paths and
resuming an interrupted transfer.

## Decision

Keep Artifact identity, immutable Revisions, workspace-scoped private R2 blobs,
and capability origins. Publish-scoped API keys and MCP principals may pin and
unpin. Pin has no scheduled expiry; unpin starts a fresh default retention
window. Pin intent is atomic with publication. Deletion and lockdown still
apply to pinned Artifacts, and their denylist markers do not lapse with a TTL.

Guarded upload sessions finalize to a ready state. Publication locks the
workspace and Artifact, checks the current tree, and commits a merged Revision.
Path expectations permit disjoint edits; snapshot digests guard full-tree or
prefix mirrors and prefix deletions. Omitted paths are preserved for partial
updates. Stale legacy draft parents conflict. An unchanged publish creates no
Revision. Explicit text edits retain verified patches.

Files above 10 MiB use fixed 4 MiB chunks through the existing workspace blob
AES-GCM implementation. The server verifies each chunk and the full-file digest
before publication. Legacy single uploads retain their existing per-plan caps,
including 25 MiB on Pro. No new cipher or encryption format is introduced.

Each new Revision has an immutable file map. A content token binds its digest
instead of embedding every path. The Content Worker verifies that map and
serves only its members. A short-lived Revision read grant lets bulk downloads
avoid an authenticated API request for every file. Download responses preserve
original bytes, including HTML, while browsing retains its content policies.
Chunked reads stream bounded chunks and support single HTTP byte ranges.
Content-hash ETags permit unchanged-file revalidation across Revisions; the
one-hour private static-asset cache policy remains unchanged.

Claimed workspace limits become 250 MiB per file, 2 GiB and 10,000 files per
Revision. Ephemeral limits stay unchanged. Deduplicated stored bytes, retained
file entries, bundles, and pending upload reservations consume a workspace
budget, defaulting to 5 GiB on Free and 50 GiB on Pro. The integer Revision
number limit replaces the 100-update ceiling for claimed Artifacts. No existing
history is pruned by this change. Garbage collection uses tombstones to exclude
concurrent reuse, protects live chunk and map references, and may delete R2
bytes only for blobs created after the migration.

ZIP generation rejects oversized input before reading bytes. Chunked files and
Revisions above the 16 MiB buffered-input ceiling use file-wise downloads.

## Consequences

Storage and pending reservations, rather than expiry alone, bound persistent
hosting. Historical data remains until explicitly retired under a separate
policy. Cleanup delays can keep unreferenced bytes charged until the age floor
and sweep pass. Pinning does not remove abuse controls or rate limits.

The protocol remains compatible with existing content tokens and legacy upload
sessions. New clients need the gateway's additional route allowlist. Rollout
requires measured 250 MiB transfers, 1 GiB trees, interrupted transfers,
concurrency, quota, retention, and memory checks, plus independent review.

## Amended decisions

This amends ADR 0048's transient-only product intent and dashboard-only pinning,
ADR 0056's claimed-workspace limits, ADR 0063's whole-file encryption boundary,
ADR 0081's Revision-based validators, ADR 0088's whole-file-only dedup and
row-only cleanup, ADR 0089's merge rules and chunk/Range deferral, and ADR 0090's
manifest cache and full-publish fallback. ADR 0100's freshness policy remains.

Current behavior belongs in [the specs](../specs/README.md). The implementation
and validation details are in the [implementation contract](../proposals/persistent-static-hosting-implementation.md).
