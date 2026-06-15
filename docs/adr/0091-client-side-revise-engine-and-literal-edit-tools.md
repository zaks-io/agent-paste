# Client-Side Revise Engine and Literal Multi-Edit Tools

[ADR 0090](./0090-agent-file-read-back-api-decrypts-member-plaintext.md) gave an
agent the read half of the patch loop (`read_file` returns a stored file's
plaintext + `sha256`) but deliberately left the diff half **CLI-only**: the CLI
diffs the working directory against a local manifest cache, and MCP `add_revision`
still re-uploads the whole entrypoint body every time. That split has two costs.

First, **MCP cannot revise incrementally at all.** `add_revision` builds exactly
one whole-file `PublishFile` from the inline `body` and sends it — no
`base_revision_id`, no patch — even though the shared `runPublish`
([ADR 0084](./0084-cli-and-mcp-share-one-publish-path.md)) and the
[ADR 0089](./0089-revision-commit-chain-tree-inheritance-and-server-reconstructed-delta.md)
upload contract already accept patched, partial-manifest input. The capability
exists end to end; the MCP caller just never populates it.

Second, **there is no surface-shared "edit this file" verb.** An agent that wants
to change a few lines of an existing artifact has to re-send the whole file (MCP)
or have a working directory to diff against (CLI). Neither matches how agents
actually express edits — as `{old_string, new_string}` replacements. The
read-back from ADR 0090 makes a true edit verb possible: read the server's bytes,
apply literal replacements, send a verified diff. But building it twice (once per
surface) would re-introduce exactly the CLI/MCP divergence ADR 0084 forbids.

The shared write path already proves the pattern: one `runPublish` sequence behind
a narrow four-method `PublishTransport` seam, two adapters (CLI over HTTPS, MCP
over Worker service bindings), all error mapping pushed to the adapters. The read
path has no such seam — each surface reads ad hoc — so a shared edit engine has
nothing symmetric to stand on.

## Decision

Extract a single **client-side revise engine** that both surfaces drive, and route
three entry points through it: the CLI `edit` verb, an MCP `multi_edit` tool, and a
**rebuilt** MCP `add_revision`.

1. **New package `@agent-paste/revise-core`.** Pure, transport-agnostic. Depends
   only on `@agent-paste/storage` (the byte-exact applier) and
   `@agent-paste/contracts` (branded types). No network, no fs, no `ApiClient`,
   no Worker bindings — so both the Node CLI and the Worker MCP bundle can import
   it.

2. **`applyEdits(body, edits[])` — the literal-edit core.** Ordered
   `{ oldString, newString, replaceAll? }` replacements. Matching is **literal**
   (`indexOf` scan, never a constructed `RegExp` — no escaping bugs, no ReDoS). An
   `oldString` that does not occur is `not_found`; one that occurs more than once
   without `replaceAll` is `not_unique`; an empty `oldString` is rejected. Edits
   apply in sequence (edit _n_ sees edit _n−1_'s output). Pure string in, result
   or typed failure out — it never hashes, reads, or publishes.

3. **`RevisionReader` — the read-side seam, twin of `PublishTransport`.**
   `{ readArtifact, readFile }`. `readArtifact` resolves the base revision's
   identity (`base_revision_id`, `entrypoint`, `title`) from the Agent View;
   `readFile` returns a stored file's plaintext + `sha256` (ADR 0090). The CLI
   adapter calls the HTTPS `ApiClient`; the MCP adapter forwards
   `agentView.getLatest` + `artifacts.fileContent` over service bindings — exactly
   how each already implements `PublishTransport`.

4. **`reviseOnePath({ reader, transport }, …)` — the orchestrator.** Read base
   identity + body → `applyEdits` → `diffWithSelfCheck` (moved into this package
   from the CLI) → build a partial-manifest `PublishInput` (only the edited path;
   every other path inherits from `base_revision_id`) → `runPublish`. It
   interprets nothing it does not own; reader and transport adapters map their own
   errors, mirroring `runPublish`.

5. **Strict fail-fast.** For an edit, `not_found` / `not_unique` / empty
   `oldString` (client, before any network), a binary or oversize base (no inline
   body to diff), a missing target path, and a server `patch_conflict` at finalize
   are all **hard errors** — never a silent whole-blob fallback. The single
   non-error fallback is the legitimate "the generated diff is not smaller than the
   whole file" case, which sends a whole-file entry **still under
   `base_revision_id`** (the result is `sha256`-verified, so this is not a
   conflict swallow). A `patch_conflict` from a base that moved underneath
   (TOCTOU) is retried **once** by re-reading the now-current base and re-applying
   the literal edits; if the edit no longer matches the fresh base, that surfaces
   as `not_found` — correct, the edit is stale and the agent must re-read.

6. **MCP `add_revision` rebuilt to preserve identity and patch.** Today it
   overwrites the artifact title with the literal `"Revision"` on every call — a
   **bug**, not a contract. Rebuilt, it reads the base revision and **preserves the
   existing title** (use `update_display_metadata` to rename). When the call's
   `render_mode` selects an entrypoint that differs from the base's, it bypasses
   the diff path and publishes a whole-file fresh-entrypoint revision (the only way
   a whole-body replace is meaningful); when the entrypoint matches, it diffs the
   new body against the stored entrypoint and sends a verified patch. A body
   identical to the current entrypoint (`sha256` equal) is a no-op that mints no
   revision. The idempotency key stays a pure function of the tool arguments — the
   added base read never feeds it.

7. **`multi_edit` (MCP) and `edit` (CLI) are thin entry points.** Both take
   `{ artifact_id, path, edits[] }` (CLI via repeatable `--old`/`--new` pairs plus
   `--replace-all`) and call `reviseOnePath`. `multi_edit` requires both `read` and
   `publish` scopes (it reads the base and publishes the revision).

8. **`render_mode` inheritance invariant.** Finalize resolves a revision's
   `render_mode` as `session ?? base ?? infer(entrypoint)` so a partial-manifest
   revise that does not re-send `render_mode` inherits the base revision's mode
   rather than silently re-inferring it from the entrypoint. The edit verbs never
   change the entrypoint, so they dodge the trap; the invariant closes it for any
   future server-read revise.

## Considered Options

- **A thin `applyEdits` helper with four injected callbacks** (`readArtifact`,
  `readFile`, `diff`, `sha256`). Rejected as speculative indirection: four ad-hoc
  callbacks is not a seam, and it fails the deletion test. The symmetric
  `RevisionReader` port — the read-side twin of the existing `PublishTransport`,
  with two real adapters — is the honest boundary.
- **A server-side edit route** (`POST` `{old,new}[]`, server reads + replaces +
  commits). Rejected. The client already holds the bytes via `read_file`; a server
  route duplicates a capability the client can assemble and puts string-replace on
  the byte-decryption tier for no isolation gain. Correctness is already enforced
  server-side by the finalize `sha256` re-validation, so the replace can live on
  the client without trusting it.
- **Keep the diff generator CLI-private and inject it into MCP.** Rejected. MCP
  cannot import from `apps/cli`; parity requires MCP generate the same verified
  diffs, so the generator must move into the shared package. The move is what makes
  "CLI and MCP have identical functionality" true in code rather than as two
  reimplementations that drift ([ADR 0084](./0084-cli-and-mcp-share-one-publish-path.md)).
- **Agent sends a unified diff directly** (instead of old/new pairs). Rejected.
  Agents hand-write incorrect diffs — the reason `diffWithSelfCheck` exists. Literal
  old/new with server-verified reconstruction is the ergonomic, safe contract.
- **A whole-blob fallback on `patch_conflict` for `edit`** (as `publish` does).
  Rejected. `publish`'s working directory is the source of truth, so a stale base
  → re-publish the whole dir is correct. `edit`'s intent is "apply these exact
  replacements to the server's content"; papering a conflict with a whole upload
  would discard the conflict the agent must see. Edit is strict where publish is
  forgiving.
- **Preserve the `"Revision"` title behavior.** Rejected — it is a bug. The
  rebuild fixes it and a regression test asserts the title is preserved.

## Consequences

- One revise engine, three entry points. MCP gains incremental patch-revise
  (closing the loop ADR 0090 deferred), the CLI gains a working-dir-free `edit`,
  and `add_revision` stops clobbering titles — all from shared code, so the two
  surfaces cannot diverge.
- `add_revision`'s title change is the one observable public-contract change. It is
  recorded in `docs/specs/mcp.md` and `docs/specs/cli.md`; existing tests pinning
  `"Revision"` are removed (they pinned a bug).
- `diffWithSelfCheck` and the unified-diff generator move out of `apps/cli` into
  `@agent-paste/revise-core`; the CLI's existing working-dir revise imports them
  from there, eliminating the would-be second copy.
- The `render_mode` inheritance fix changes finalize's inherit semantics; it is
  gated behind the finalize re-validation tests.
- Builds on [ADR 0090](./0090-agent-file-read-back-api-decrypts-member-plaintext.md)
  (read-back), [ADR 0089](./0089-revision-commit-chain-tree-inheritance-and-server-reconstructed-delta.md)
  (commit chain + delta), and [ADR 0084](./0084-cli-and-mcp-share-one-publish-path.md)
  (one publish path); reverses ADR 0090's "the diff half stays CLI-only" deferral.
