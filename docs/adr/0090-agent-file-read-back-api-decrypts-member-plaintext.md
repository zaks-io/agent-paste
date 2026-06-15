# Agent File Read-Back: `api` Decrypts and Returns Member Plaintext

[ADR 0089](./0089-revision-commit-chain-tree-inheritance-and-server-reconstructed-delta.md)
gave the server everything it needs to accept a **partial-manifest publish with
per-file unified-diff patches**, and Stage 4 made reconstruction fail loud at
finalize (`patch_conflict`). But an agent can only _produce_ a correct unified
diff if it can read the file it is changing — with the exact bytes and the exact
plaintext `sha256` the server will validate the patch base against. An agent that
already has the working directory (the common CLI case) reads from disk; an agent
without it (MCP, a fresh session, another machine) had **no way to read a stored
file back**. `read_artifact` returns metadata only — paths, sizes, content types,
and a signed browser `url` — never the bytes and (until now) not even the `sha256`.

Without a read-back, the patch loop cannot close for the no-working-dir case: the
agent would guess a base, the diff would fail to apply, and the Stage 4 conflict
flag-back would tell it "your base was wrong" with no way to fix it.

## Decision

Add a **member-authed file read-back** so an agent can fetch one stored file's
plaintext and its `sha256`, then diff against it.

1. **`sha256` on the Agent View file entries.** `AgentViewFile` gains an optional
   `sha256` (the plaintext content address). An agent compares it against its local
   copy to decide what changed before reading anything back. Optional because
   diff-only / draft rows have no materialized blob.

2. **A new read route in `api`, not `content`.** `GET
/v1/artifacts/{artifact_id}/file-content?path=&revision_id=` (member-authed,
   `read` scope, `actor` rate limit) returns
   `{ path, sha256, size_bytes, content_type, is_binary, body? }`. The file path
   travels as a query param because it may contain `/`, which route-path building
   encodes and Hono `:param` will not match. `revision_id` pins the read to a
   Revision (the CLI pins it to its cached base so the diff base and the inherit
   base are the same Revision); absent means latest.

   - **`is_binary` is byte-derived, true binary only** (`decodeUtf8Strict(bytes)
=== null`, the same helper the diff applier uses). It is NOT "too big to
     inline." A text file over the inline cap is `is_binary: false` with `body`
     ABSENT; the agent reads that as "text, fetch via the content url or upload
     whole, never a patch."
   - **Oversize files skip the R2 read entirely.** If `size_bytes > 10 MiB` the
     route returns metadata with no body WITHOUT reading or decrypting R2, so a
     single request never buffers a multi-megabyte decrypt (honoring the ADR 0063
     no-buffering intent on the decrypt path). The inline cap reuses the existing
     10 MiB MCP text-body limit — no new magic number.
   - Infra failures (missing ring/R2, decrypt/metadata error) map to
     `storage_unavailable` (503), never `not_found` — a transient blob miss must
     not look like a deleted file.

3. **`api` now decrypts artifact bytes and returns plaintext.** This is the
   boundary-relevant decision: until now only the **`content`** Worker decrypted
   stored bytes on read ([ADR 0063](./0063-application-layer-encryption-for-artifact-bytes.md),
   behind a content-gateway token, streamed). `api` already holds
   `ARTIFACT_BYTES_ENCRYPTION_KEY` in its env but never exercised it on a read.
   The new route reuses `readWorkspaceBlobBytes` (the Stage 4 helper) to decrypt a
   single blob and return its plaintext over a member-authed JSON API.

   This does **not** widen the confidentiality boundary: the caller is the owning
   **Workspace Member**, who already owns the artifact and can fetch the same bytes
   through the signed `AgentViewFile.url`. Encryption defends the **platform tier**
   (Cloudflare-side R2 misconfiguration / object-store insider), not the owning
   member, so returning plaintext to that member is not a leak. `api` stays in the
   [ADR 0045](./0045-secret-rotation-cadence-and-on-demand-tooling.md) key-rotation
   set for `ARTIFACT_BYTES_*`. `content` is untouched — its no-DB isolation and
   streamed whole-object decrypt are unchanged.

4. **The blob key is never client-controlled.** The client supplies
   `(artifact_id, path)`; the route resolves the file row under the actor's
   **workspace scope** (RLS, via `getAgentView`), derives the object key from
   `(workspace_id-from-actor, validated-row-sha256)`, and the AES-GCM AAD binds
   both — a substituted key or sha cannot decrypt. A cross-tenant artifact returns
   `not_found` with no existence oracle. This mirrors the Stage 4 reconstructor
   seam exactly.

5. **An MCP `read_file` tool** forwards to the same route (read-only parity for the
   no-shell surface). MCP `add_revision` stays text-body-only: the patch-producing
   path lives in the CLI, which has the working directory to diff. This is the
   minimal change consistent with
   [ADR 0084](./0084-cli-and-mcp-share-one-publish-path.md) (one shared publish
   path, no duplicate implementation).

6. **The CLI diff client (the ergonomics payoff).** The CLI caches the last
   published manifest per artifact (`paths + sha256 + revision_id`) under
   `configDir()`. On a revise (`publish --artifact-id`) it diffs the working dir
   against the cache and sends only changed/added files + `deleted_paths` against
   `base_revision_id`; unchanged files inherit by omission. A changed text file is
   sent as a verified unified diff (whole-blob for binary or when the diff is not
   smaller); the generator self-checks by applying its own diff and comparing the
   result digest before attaching the patch, so a generator bug degrades to a
   correct whole-blob upload, never a finalize conflict. **No size threshold** —
   always diff changed text (KISS); the server byte-verifies regardless.

   A stale or unusable cached base (concurrent revise elsewhere, retained/deleted
   base, a non-inheritable base file) makes finalize return one of a known set of
   base-unusable errors; the CLI catches them, drops the cache, and re-publishes
   the whole working directory once (the bytes are on disk). A corrupt or
   schema-drifted cache is treated as a cache miss → full publish. The cache holds
   no bytes and no secrets and is written `0o600`.

## Considered Options

- **Read-back in `content`.** Rejected. `content` has no DB (it cannot resolve
  `(artifact_id, path)` → blob `sha256`) and serves via signed Access Link, not
  member auth. Giving it a DB binding or a side channel breaks the isolation the
  **Content Origin** exists to provide
  ([ADR 0001](./0001-private-artifact-storage-behind-controlled-origin.md),
  [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md)).
- **Return raw base64 for every file.** Rejected. It bloats text reads ~33% and
  pushes binary detection onto the agent; text body + an `is_binary` flag is the
  ergonomic match for a diff-producing agent.
- **A patch byte-size threshold (only diff when much smaller).** Deferred. A
  speculative magic number; the diff/self-check + the "not smaller → whole-blob"
  guard already cap the worst case. Add a threshold only if a real workload proves
  it pays off.
- **Extend MCP `add_revision` to carry a partial/patched file set.** Deferred. An
  MCP agent sends a single inline body over JSON-RPC with no base bytes to diff;
  the patch path belongs where the working directory is (the CLI). `read_file`
  gives MCP the read half; the diff half stays CLI-only.

## Consequences

- An agent without the working directory can now read the true base and produce a
  correct patch, closing the Stage 4 loop for the MCP / fresh-session case.
- `api` is a second byte-decryption surface. It is member-authed, per-actor rate
  limited, size-capped before the read, and returns plaintext only to the owning
  member. Future readers seeing `api` decrypt should not assume a leak — the
  boundary is unchanged from ADR 0063.
- The `ArtifactFileContent` response is `.strict()` and is the MCP `read_file`
  output contract; the route builds it from a fixed field set so no extra field
  can leak and silently 500 the MCP parse (the class of bug behind earlier strict
  envelope / null-revision incidents). A test asserts the real handler output
  parses under the strict contract.
- Builds on [ADR 0089](./0089-revision-commit-chain-tree-inheritance-and-server-reconstructed-delta.md);
  amends [ADR 0063](./0063-application-layer-encryption-for-artifact-bytes.md)'s
  "decrypt-on-read is `content`-only" note (now `content` + the member read route
  in `api`). Defers Range serving, a patch threshold, and an MCP patch path.
