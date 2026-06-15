# Publish Returns One Viewer URL, Private By Default

> **Superseded by [ADR 0086](./0086-publish-is-content-only-private-first.md).**
> This ADR made `viewer_url` flip between a private and a public grant and surfaced
> that as a `shared` boolean. In practice that conflated "which URL" with "is it
> public," so a revise that did not re-assert `share` reported `shared:false` and
> handed back a different URL — a confusing, dishonest output, and a default that
> created no-login access when the caller did not ask. ADR 0086 makes publish
> content-only and private, returns one private viewer link, and moves unlisted
> sharing to a separate explicit, revocable step.

An agent's core job on this product is "publish an **Artifact**, get back a link."
The link is the deliverable. So the publish surfaces must return _a link the
caller can open_, and the rules for which link and who can open it must be dead
simple — one concept, not a menu.

Before this decision the publish output exposed the link model's internals. The
REST `PublishResult` carries `artifact_url` (the authenticated **Private Link**),
`access_link_url` (a **Share Link**'s signed URL, present only when sharing was
requested), `revision_content_url`, and `agent_view_url`. The CLI chose between
them at render time (`access_link_url ?? artifact_url`); the MCP exposed
`access_link_url` only, so a default publish returned **no openable link at
all**. An agent had to understand four URL fields and the Private-vs-Access-Link
distinction just to answer "give me the link."

## Decision

Publish (CLI and MCP, through the one shared path of [ADR
0084](./0084-cli-and-mcp-share-one-publish-path.md)) returns **one** link to the
caller: `viewer_url`, plus a `shared` boolean.

- **Private by default.** With no `share`, `viewer_url` is the **Private Link**
  (the authenticated **Artifact URL**) — it opens only for the owning
  **Workspace Member**. Nothing is exposed by URL until the caller asks.
- **Sharing is one bit.** With `share` on, `viewer_url` is the public **Share
  Link**'s **Access Link Signed URL** — anyone with the URL can open it, no
  login — and `shared` is `true`. A shared **Artifact** keeps **one stable
  Share Link** that follows the latest **Published Revision** (the server reuses
  an active Share Link before creating one), so the URL you hand out keeps
  working and live-updates across revisions.

`viewer_url` is an **output-surface convenience**, not a new grant. Private vs
shared is still the existing **Private Link** / **Access Link** distinction,
governed by the single `share` bit. The MCP publish output is exactly
`{title, viewer_url, shared, expires_at, upload_stats?}`; the CLI renders
`viewer_url` as its `View`/`→ open` line and still carries the full
`PublishResult` in its JSON for automation. Artifact IDs, Revision IDs, content
URLs, and the Agent View URL remain available through the explicit
read/list/link tools — they are just not the headline an agent has to wade
through to find the link.

## Considered Options

- **Return the full multi-URL `PublishResult` from both surfaces.** Rejected. It
  makes the agent understand four URL fields and the grant model to find the one
  link, and it tempts the agent to hand out the wrong one (e.g. an authenticated
  `artifact_url` that the recipient can't open, or an `access_link_url` the user
  didn't intend to create).
- **Make every publish auto-mint an unlisted Share Link.** Rejected. It violates
  "no surprises" — an agent publishing a draft would make it world-readable by
  URL without anyone asking. Private-by-default is the safe default; sharing is
  an explicit, single, reversible bit.
- **Collapse Private Link and Share Link into one grant.** Rejected, and recorded
  so it is not "simplified" into later: they are different security boundaries
  (authenticated owner-only vs unauthenticated by-URL). `viewer_url` unifies the
  _output_, not the grants; merging the grants would erase the auth boundary.
- **One `viewer_url` + a `shared` bit, private by default (chosen).** One concept
  to reason about, the safe default, an honest reflection of which grant backs
  the URL.

## Consequences

- **An agent can answer "publish and give me the link" with the publish result
  alone** — no follow-up `list_artifacts`/`create_share_link` round-trip, which
  also sidesteps the draft-`list_artifacts` failure path.
- **The MCP output dropped `access_link_url`** in favor of `viewer_url` +
  `shared`. The product is pre-launch, so this is a clean break with no
  compatibility shim.
- **New domain vocabulary.** [`CONTEXT.md`](../../CONTEXT.md) adds **Viewer URL**
  as the single returned link that resolves to the **Private Link** when private
  and the **Share Link** when shared.
- **The link model is unchanged underneath.** Private Link, Access Link, and
  Share Link keep their existing definitions and grants; this ADR only changes
  what the publish surfaces _return_ and defaults sharing to off.

## What this ADR is not

- Not a new link type. `viewer_url` is whichever existing grant backs the
  publish; it is not a third grant with its own lifecycle.
- Not a change to who can read a private vs shared **Artifact**. The
  authentication boundary is the same; only the default (private) and the output
  shape (one link) change.
