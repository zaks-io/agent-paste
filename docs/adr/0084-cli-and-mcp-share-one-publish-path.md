# CLI And MCP Are Two Transports Over One Publish Path

The **CLI** and the **MCP** server are two interfaces over the same product. A
user who can publish an **Artifact** from the CLI must be able to publish it from
MCP, the same way, with the same result. The only thing that legitimately differs
between them is the transport — the CLI is a shell binary that reads files from
disk and talks to the public API over HTTPS; the MCP server is a Cloudflare
Worker that receives an inline text body and talks to the API over service
bindings. The publish _logic_ is not a place they are allowed to differ.

They did differ, and it caused real bugs. Before this decision each surface had
its own publish implementation:

- The CLI drove `uploadSessions.create → putFile → finalize →
revisions.publish({share})` itself and rendered the full `PublishResult`.
- The MCP server had a separate `runTextPublishChain` that re-ran that same
  sequence, then — instead of letting `revisions.publish({share:true})` mint the
  link the way the CLI did — reimplemented sharing with its own
  `accessLinks.list → create → mint` chain, and narrowed the output to
  `{title, access_link_url?, expires_at, upload_stats}`.

Two consequences fell straight out of the divergence. A default MCP publish
returned **no link at all** (the CLI always returned one), so an agent asked to
"publish this and give me the link" had nothing to hand back. And `list_artifacts`
500'd on drafts in production through the MCP's stricter output path while the CLI
path was unaffected — the same class of "works in one surface, not the other"
that this ADR exists to forbid.

## Decision

There is **one publish path**: `runPublish` in `@agent-paste/api-client`
(`packages/api-client/src/publish.ts`). Both the CLI and the MCP server call it.
A change to publish behavior is made once, in that module, and both surfaces get
it. Reintroducing a second, surface-specific publish implementation is the thing
this ADR prohibits.

The single point of legitimate difference is a transport seam — a four-method
`PublishTransport` interface (`createUploadSession`, `putFile`, `finalize`,
`publishRevision`) with exactly two adapters:

- **CLI** (`apps/cli/src/publish-transport.ts`) delegates to the HTTPS
  `ApiClient`.
- **MCP** (`apps/mcp/src/publish-transport.ts`) wraps the Worker service-binding
  forward helpers.

`runPublish` interprets no errors and contains no share-link logic; both live
where they belong (the adapter maps transport errors; the server mints/reuses the
Share Link). Each caller keeps only what is genuinely transport- or
surface-specific: the CLI keeps disk file-walking, `--ephemeral` provisioning,
its nonce idempotency key, and human/JSON rendering; the MCP keeps its
deterministic replay-safe idempotency key and the ADR-0079 scope gate. Everything
between "I have the bytes" and "here is the result" is shared.

The shared output is one link. Publish is content-only and private-first: it
returns a single `private_url` — the authenticated **Private Link** (the
`/v/<artifactId>` clean viewer) — and carries no visibility input and no `shared`
field. (Output shape `{title, private_url, expires_at, upload_stats?}`.)
Unlisted no-login sharing is the separate `set_visibility` /
`agent-paste set-visibility <artifact-id> unlisted` step.
See [ADR 0086](./0086-publish-is-content-only-private-first.md) for the current
link model; this ADR is only about the two surfaces sharing the path. _Amended by
ADR 0086: the original `viewer_url` + `shared` shape from [ADR 0085](./0085-publish-returns-one-viewer-url.md) is superseded._
that produces it.

To keep the MCP Worker bundle free of the Node-only `ApiClient` (which reads
`process.env`), the shared module is exposed on its own Worker-safe subpath,
`@agent-paste/api-client/publish`, importing only contracts types and
`crypto.subtle`. The MCP imports `runPublish` from that subpath, never from the
package barrel.

## Considered Options

- **Two implementations kept in sync by a parity test.** Rejected. A test that
  guards two hand-maintained copies is not a single source of truth — it
  notices drift after the fact instead of making drift impossible, and it is
  exactly the divergence that shipped the no-link-on-MCP and draft-500 bugs.
  Generate-the-artifact-and-delete-the-guard is the standing preference; here the
  "artifact" is the shared module.
- **Share the `ApiClient` itself across both surfaces.** Rejected. The CLI's
  `ApiClient` does raw `fetch` to public URLs and reads `process.env`; the MCP
  Worker uses service bindings against an internal host with manually built
  request headers. A `fetch?`-override shim cannot bridge that honestly (the
  binding signature is not `typeof fetch`, and the R2 PUT goes to a presigned
  URL through the global `fetch` in both, not through any binding). The real,
  testable seam is the four-method `PublishTransport`, with two genuine adapters.
- **One shared path with the transport seam (chosen).** One implementation, one
  place to fix behavior, transport differences isolated behind an interface with
  two real adapters and a fake for tests.

## Consequences

- **A fix in one surface is a fix in the other, by construction.** No reviewer
  has to remember to mirror a publish change into the second implementation,
  because there is no second implementation.
- **The MCP's bespoke share chain is deleted** (`apps/mcp/src/publish-chain.ts`).
  The server mints/reuses the Share Link for both surfaces ([ADR
  0085](./0085-publish-returns-one-viewer-url.md)); the MCP no longer forwards to
  any access-link route during publish.
- **The transport seam is the test surface.** `runPublish` is unit-tested against
  a fake `PublishTransport`; each adapter is tested for transport-specific
  behavior (CLI byte-for-byte wire shape, MCP error-code propagation). The
  publish logic is tested once, not twice.
- **This does not merge the two binaries.** The CLI stays a shell tool with
  login/logout/upgrade and disk handling; MCP stays a Worker. Surface-shaped
  concerns stay surface-specific. What is unified is the publish path, not the
  programs.
- **New domain vocabulary.** [`CONTEXT.md`](../../CONTEXT.md) gains **Viewer URL**
  for the one returned link; the principle that the two surfaces share one logic
  path is recorded here so it is not "optimized" away later by a surface-local
  reimplementation.

## What this ADR is not

- Not a claim that the CLI and MCP expose the _same set of commands_. MCP has no
  `login`/`logout`/`upgrade` (shell concerns), and the CLI has no remote
  tool-call envelope. It is a claim that where they do the same thing — publish —
  they do it through the same code.
- Not a license to push more into the shared module than belongs there. Transport,
  credential acquisition (including ephemeral provisioning), idempotency-key
  derivation, and output rendering stay caller-specific by design.
