# Persistent static hosting

Proposal, 2026-11-02. Investigated against `d82a6a8d`, current GitHub branch and
PR metadata, Linear, and a read-only `agent-paste whoami --json` call against
Isaac's workspace. Revised after an Opus 5.5 review on the same date. The
revision has not received a second review. Isaac subsequently specified a
250 MB per-file requirement. This remains a proposal, not an accepted spec or
implementation.

## Outcome

Agent Paste should host arbitrary static directories at stable URLs. An agent
can keep a chosen Artifact indefinitely, discover and manage existing Artifacts,
and synchronize a local directory without recreating its URL or uploading every
file again. Partial uploads and downloads are first-class operations: an agent
can transfer selected files or subdirectories without holding or transferring
the rest of the Artifact. These features do not depend on what the files contain.

Isaac reports directories around 1 GB. Use at least 1 GiB per complete Revision
as the initial validation target. The required individual-file ceiling is
250 MiB, or 262,144,000 bytes, following the repository's existing binary-unit
convention for limits described as MB. This replaces the earlier 25 MiB
recommendation. File count remains a separate capacity dimension and must be
stated in the resulting contract.

Keep the existing Artifact, immutable Revision, private R2 storage, isolated
content host, and atomic publish model. No separate hosting product or content
category is needed. Persistent means no scheduled expiry, not protection from
explicit deletion or platform lockdown.

## What exists

- Pinning already exempts an Artifact from automatic deletion. Its durable
  capability token has `exp: null`, so it does not need periodic renewal.
  Pinning and unpinning preserve the URL. Only dashboard routes expose these
  operations today. Enforcement uses the effective `live_artifacts_cap`, which
  is 50 on Free and 1,000 on Pro. The exported `PINNED_ARTIFACT_CAP = 50`
  constant is not the enforced pin allowance.
- `publish <directory> --artifact-id <reference>` updates the same URL. The
  shared publisher supports content hashes, blob reuse, partial file trees,
  deleted paths, verified text patches, and immutable parent Revisions.
- The CLI keeps a local manifest cache. A fresh machine falls back to a full
  manifest, with server-side blob reuse still possible. An unchanged folder
  creates another Revision. Some unusable-base errors trigger full replacement.
  This is useful incremental publishing, but it is not a reliable multi-agent
  synchronization contract.
- CLI `pull` reads one file; `download` saves a Revision ZIP. MCP already has
  list/read/delete and editing tools. The CLI has no list, pin, or unpin command.
- Image-heavy browsing was improved in [AP-449](https://linear.app/zaks-io/issue/AP-449)
  and [PR #668](https://github.com/zaks-io/agent-paste/pull/668). Content allows
  600 requests per minute per Artifact and visitor IP, plus 3,000 capability
  lookups per minute per IP across Artifacts. These are approximate edge limits.
  Fresh static browser caches avoid requests; conditional requests count.

The live workspace currently reports 10 MiB per file, 25 MiB per Revision,
100 files per Revision, 50 live Artifacts, 100 lifetime Revisions per Artifact,
60 authenticated requests per actor per minute, and 300 per workspace per
minute. Its default lifetime is three days. Pinning bypasses expiry but does
not bypass these other limits. Pro still has the shared 100-file and
100-lifetime-Revision ceilings; its size limits are 25 MiB per file and 100 MiB
per Revision. Upgrading alone does not meet this request.

## Related branches and work

I found no open PR and no identifiable unfinished persistent-hosting or folder-sync
branch in the local and remote branch inventory. This does not establish that
no unpushed work exists elsewhere.

Relevant completed work is already on main:

- [AP-24](https://linear.app/zaks-io/issue/AP-24) added pinning and Revision retention.
- [PR #471](https://github.com/zaks-io/agent-paste/pull/471), branch
  `bug-hunt/artifact-pinning`, fixed pinned expiry and purge handling.
- [PR #529](https://github.com/zaks-io/agent-paste/pull/529) added the Revision
  chain, inherited files, patches, and agent read-back.
- [PR #669](https://github.com/zaks-io/agent-paste/pull/669) added static browser caching.

Two existing open issues need explicit verification in this work:

- [AP-483](https://linear.app/zaks-io/issue/AP-483) reports that the managed
  sandbox gateway rejects revising an existing Artifact with `CLI endpoint not
allowed`. Authentication succeeded in this investigation; revision publishing
  through that gateway was not exercised. Gateway changes belong to its owner.
- [AP-357](https://linear.app/zaks-io/issue/AP-357) describes denylist entries
  expiring before content authorization. The current shared writer still uses
  a seven-day TTL. Reassess the issue against today's capability URLs and
  non-expiring pins. Changing seven days to ninety is insufficient for permanent
  authorization. This is source evidence, not a reproduced production exploit.

## Implementation sequence

### 0. Verify the gateway and isolate the existing lockdown defect

Verify AP-483 through the real managed gateway before building new agent
operations. Use a disposable test Artifact in an approved environment. Track
required gateway routes with the host owner alongside each implementation
slice, rather than discovering missing allowlist entries at final handoff.
Production writes still require explicit approval.

Address AP-357 as a separate security fix. Source inspection shows platform
lockdown writes a seven-day KV marker while leaving a pinned, non-expiring
capability manifest intact. No refresh mechanism was identified. Recommend
lockdown markers without a TTL, removed only by explicit lift. Keep deletion
markers until manifest removal, byte cleanup, and outstanding authorization
lifetimes make removal safe. Test existing persisted markers as well as new
writes so the rollout repairs previously locked-down Artifacts.

This defect already affects dashboard pins. It should not be buried in a new
feature or require the larger hosting redesign. No production exploit was
reproduced during this assessment.

### 1. Expose permanent retention and management to agents

Reuse pin/unpin through authenticated agent routes, the API client, CLI, and
MCP. Add CLI list/read/delete wrappers for existing management operations.
Pin currently rejects non-member actors in the repository workflow, so API-key
support requires a deliberate authorization change, not only route wiring.
Recommend publish-scoped agent credentials can pin and safely unpin within their
own workspace. Preserve ephemeral restrictions, audit, and idempotency.

Provide `pin <reference>`, `unpin <reference>`, and `publish ... --pin`.
Carry pin intent server-side and commit it with the publication state, rather
than performing separate client publish and pin calls. Return success only
when the durable capability reflects the requested retention. Preserve the
existing URL when pinning an active Artifact.

Make retention reporting additive. Keep the stored `expires_at` field for old
clients and add `retention: "pinned" | "temporary"` with nullable
`effective_expires_at` to read and publish results. Expose effective pin allowance.

Unpin currently reinstates a possibly expired date. Recommend a fresh ordinary
retention window, returning its deadline. Alternatively refuse an already-expired
unpin unless explicitly requested. Decide this before exposing agent unpin.

Primary owners: contracts, database lifecycle workflows, API, API client, CLI,
and MCP. This increment leaves size and Revision ceilings unchanged.

### 2. Make partial transfers and sync correct at current limits

Extend `publish` for complete-tree publication and explicit selected-path updates.
Use existing inherited-file and patch support, with these guarantees:

- A partial upload selects files or directory prefixes and explicitly maps local
  paths to remote paths. It needs no complete checkout. Missing or excluded
  paths never imply deletion. Apply selected changes to the current remote
  tree, preserving unrelated concurrent updates.
- Check expected hashes or expected-absent conditions for every changed or
  deleted path at commit. Disjoint updates may succeed; overlapping changes
  conflict. Full-tree replacement and mirror operations use an expected-head
  condition. Prefix deletion must also detect newly added or changed descendants.
  A pre-upload check alone is insufficient. Final file-map publication must
  remain atomic and must not mutate an already immutable Revision.
- Support explicit prefix deletion without expanding thousands of paths into
  the current 100-entry deletion array. Enforce normalized prefix boundaries,
  entrypoint validity, and the resulting complete-tree quotas.
- Remove silent whole-tree replacement on an unusable partial base. Conflicts
  return enough information to re-read and retry deliberately.
- Add dry-run additions, changes, removals, reused bytes, and effective limits.
  Distinguish partial update, scoped mirror, and full replacement in output.
  Skip unchanged content and metadata without creating another Revision.
- Support selected-file, selected-directory, and complete-tree `pull`, including
  binary files on disk. Preserve the existing single-file syntax and protect
  local files outside the selection. Detect overwrites, verify hashes, and bind
  the entire download to one Revision. Do not require the full ZIP.
- Preserve sensitive-file and symlink protections, add include/exclude controls,
  and use bounded retries with stable operation identities and `Retry-After`.

Partial selection and interrupted-transfer resume are separate guarantees.
The current-limit increment may resume at file granularity. The completed
250 MiB implementation must also resume interrupted files at verified chunk
boundaries without retransferring the entire file.

MCP uses the same retention, discovery, selected-path edit, and management
contracts. Bulk filesystem transfer remains a CLI operation; no gigabyte JSON
payloads. Primary owners: CLI, contracts, API client, database publication
workflow, publish coordinator, and MCP.

### 3. Remove the actual scaling bottlenecks

Support individual files up to 250 MiB and aggregate directories of at least
1 GiB. Whole-file buffering and single-shot decryption cannot be the large-file
path. The confirmed per-file requirement brings bounded chunk processing into
scope; increasing numeric caps alone is insufficient.

- Hash CLI files incrementally and keep metadata, rather than retaining the
  entire directory's bytes in `Promise.all`. Open file bodies only for bounded
  concurrent transfers. Detect changes between hashing and upload. Measure
  client and Worker peak memory at the chosen per-file and concurrency caps.
- Add bounded, resumable chunk uploads and streaming downloads. Persist verified
  part progress, renew expired grants, and finalize only after verifying the
  complete file's length and digest. Bind parts to the authorized workspace,
  upload, and file so retries cannot mix content. Reuse completed verified
  parts after interruption and clean up abandoned uploads safely.
- Introduce a reviewed, versioned authenticated-chunk encryption format for
  large files. Authenticate each chunk before serving its plaintext, with
  integrity protection for ordering and total length and safe nonce handling.
  Preserve reads of existing encrypted objects. Do not invent a cryptographic
  construction or remove encryption to fit the size target.
- Implement plaintext byte-range reads over authenticated chunks, with correct
  `206`, `416`, `Content-Range`, and validator behavior. Resume downloads against
  one immutable Revision and representation. Neither upload nor download may
  buffer a complete 250 MiB file. Bound memory by chunk size and concurrency.
- Move the path-to-object map out of the 64 KiB signed token into one immutable
  per-Revision R2 object carrying paths, sizes, hashes, and object references.
  Bind authorization to its Revision and digest. Verify the digest before use,
  cache parsed maps by digest with bounded memory, and preserve tenant/path
  authorization. Introduce shards only if measurements require them. Keep
  Postgres out of the content request path.
- Separately paginate API file listings and batch upload-session registration.
  These address the 100-file schemas and response-size bounds, not token size.
  Seal a complete session before finalize and never expose an incomplete tree.
- Issue a bounded-lifetime Revision-scoped read capability so multi-file pulls
  do not make an authenticated API call per file. Authorize paths against the
  immutable map and continue checking lockdown and deletion. Refresh access to
  the same Revision during a long download. Content read limits still apply.
- Guard archive generation before loading any file bytes. Introduce an explicit
  input-memory bound; retain the existing compressed-output size check too.
  Mark unsupported large archives disabled with a clear reason. Whole-tree
  and partial downloads use file-wise `pull`. Preserve existing ZIP `download`
  behavior for supported sizes and make the large-archive limitation explicit.
  Do not add streamed encrypted ZIP or lazy archive infrastructure in this slice.
- Reuse verified complete blobs across sessions as well as verified parts within
  resumable uploads. Protect them with pending-session/reference leases and prove
  cleanup cannot delete bytes used by a committed Revision. Blob reuse skips
  completed files but does not replace the required within-file resume support.
- Use content-hash validators for unchanged file representations, accounting
  for content encoding and type. Preserve the current one-hour asset freshness
  policy unless a separate freshness change is accepted.

Primary owners: CLI file readers, shared publisher, upload sessions, storage,
capability tokens and maps, content Worker, API listings, and bundle jobs.

### 4. Set storage and history policy, then raise limits

Before increasing limits or lifting the lifetime Revision ceiling, introduce
workspace stored-bytes accounting and enforce a chosen budget. Count distinct
referenced blobs, with explicit accounting for bundles, legacy objects, and
pending uploads. Concurrent sessions need reservations or an equivalent atomic
quota check; per-Revision checks alone cannot enforce a workspace budget.

Separate current publication from retained history. Pinning keeps the current
publication indefinitely. Decide whether older Revisions remain indefinitely
within a byte budget or follow an opt-in history window. Remove the lifetime
update ceiling for persistent Artifacts once this policy is enforced, so the
same URL remains editable beyond 100 updates. Do not merely substitute another
permanent update ceiling. Never prune current files, retained references, or
live uploads. Removing existing history requires explicit approval.

Only then raise file-count and per-Revision limits on preview and prove at least
1 GiB directories. Test both many small files and fewer files near the per-file
cap. Measure content request budgets after eliminating per-file API calls;
change rate limits only where measured transfers or browsing still fail. Expose
retry and quota details that agents can act on.

Document MIME, cross-origin access, GET, HEAD, conditional reads, and supported
Range behavior. The 250 MiB path must use bounded chunk decryption, including
for Range requests. Keep content isolated from management authentication.

Update features, CLI/API specs, README, and public agent instructions with each
slice. Fix the expiry documentation that calls the stored timestamp the content
lifetime even for pins while agent views strip pin state. Friction receipt 1221
records this contradiction. Change synced skill sources upstream.

## Decisions before implementation

The review identified policy choices, not prerequisites for finishing this plan.
Recommendations remain proposals:

- The individual-file ceiling is now specified at 250 MiB. Choose and review the
  chunk format, transfer protocol, chunk size, and concurrency limits against
  that requirement. The prior recommendation to defer large-file encryption
  and within-file resume no longer applies.
- Permit publish-scoped API keys and authenticated MCP actors to pin and unpin
  their workspace's content. Define the exact authority in the contracts.
- Give unpin a fresh ordinary retention window rather than reactivating a past
  deletion deadline.
- Choose a workspace stored-bytes budget and how it applies to existing plans.
  Choose indefinite history within that budget or an opt-in history window.
  Neither numerical value has been approved.
- Preserve current asset freshness initially. Instant visibility of reused
  asset paths requires an explicit cache-policy decision. Content-hash ETags
  help revalidation but cannot invalidate a still-fresh browser cache.

## Compatibility and alternatives

Exposing pin alone is the smallest useful first release, but it does not solve
the 1 GiB or continued-update requirements. A Pro upgrade also leaves hard shared
ceilings intact. Periodic renewal would add a background dependency to link
survival despite permanent pin support already existing. Removing every limit
would not fix buffering, manifest size, concurrency, or interrupted uploads.

Recommend extending the existing design in the sequence above. Version any new
manifest or encryption representation and continue reading currently published
objects. Make retention metadata additive first. Preserve current URLs and
small-file client behavior throughout deployment. Record amendments to the
transient-default, quota, encryption, Revision, and capability ADRs, then fold
accepted behavior into specs. No speculative new billing tier is required by
this proposal.

## Done

- An agent pins an existing link, sees confirmed permanent retention, and keeps
  the same working URL beyond the former deadline and through lifecycle sweeps.
- The same Artifact accepts more than 100 meaningful updates.
- A directory of at least 1 GiB publishes and downloads with measured bounded
  client and Worker memory. Test both many small files and fewer larger files,
  at the declared file-count and per-file limits.
- A 250 MiB file uploads, serves, and downloads with verified integrity and
  bounded memory. A file one byte above the cap is rejected before accepting
  its full body. Exercise simultaneous large-file transfers under the measured
  concurrency limit, including incompressible data.
- Interrupted large-file uploads and downloads resume at verified chunk
  boundaries. Test expired grants, corrupt or missing chunks, reordered parts,
  valid and invalid byte ranges, and concurrent publication without mixing data.
- Interrupted transfers resume without retransferring completed, verified files. Repeating
  an unchanged publish transfers no file bodies and creates no Revision.
- From a machine without a full checkout, upload one file or a selected subtree
  into a 1 GiB Artifact. Unselected remote paths retain their exact bytes, and
  omitted or excluded paths are not deleted. A failed partial upload exposes
  none of its changes.
- Download one file or a selected subtree without transferring unrelated file
  bodies or a full ZIP. Verify binary integrity and unchanged local files outside
  the selection. A concurrent publish cannot mix Revisions in the download.
- Resume interrupted partial uploads and downloads. Missing paths, conflicting
  selections, local overwrites, explicit removals, and stale remote Revisions
  have tested, deterministic outcomes.
- A second machine can discover, pull, and update the Artifact. Concurrent
  agents cannot silently overwrite each other's publication. Disjoint partial
  updates preserve both agents' changes; overlapping updates and prefix deletion
  races conflict safely.
- Adds, changes, and removals become visible together. Failed upload or finalize
  leaves the previous publication usable. HTML updates on reload; asset freshness
  matches the explicitly chosen cache policy.
- Pinning, unpinning, deletion, lockdown, quota failures, retries, and cleanup
  pass lifecycle tests. A locked-down pinned Artifact stays blocked beyond
  seven days, including Artifacts locked down before the fix was deployed.
- Concurrent uploads cannot exceed the workspace storage budget. Cleanup preserves
  current, retained, and pending references. Oversized archive jobs are rejected
  before reading file bytes; file-wise full and partial downloads remain usable.
- Real CLI publishing and revising work through the managed gateway. Hosted
  MCP management works through its authenticated binding path.
- Focused tests, `pnpm verify`, preview upload/download and browsing checks,
  and required independent review pass. Production rollout remains an explicit
  approval step after preview evidence is ready.

## Evidence and limits of this investigation

Primary specifications: `docs/specs/features.md`, `data-model.md`, `api.md`,
`cli.md`, `content-rendering.md`, and `jobs.md`.

Primary implementation evidence: `packages/config/src/index.ts`,
`apps/cli/src/index.ts`, `publish-preflight.ts`, `revise.ts`, `manifest-cache.ts`,
`packages/api-client/src/publish.ts`, `packages/contracts/src/uploadSessions.ts`,
`packages/contracts/src/agentView.ts`, `apps/api/src/agent-view.ts`,
`packages/db/src/repository/workflows/upload-publish-workflow.ts`,
`packages/db/src/byte-purge-shared.ts`, `apps/upload/src/put.ts`,
`packages/storage/src/artifact-bytes-encryption.ts`,
`packages/tokens/src/content-capability.ts`, `apps/content/src/serve-object.ts`,
and `apps/jobs/src/bundle/generate-zip.ts`.

This investigation verified authentication and effective workspace policy live.
It did not publish, pin, delete, deploy, load-test production, or reproduce the
open gateway and denylist reports. No application code was changed. The plan's
capacity and lifecycle acceptance checks are future implementation gates.
