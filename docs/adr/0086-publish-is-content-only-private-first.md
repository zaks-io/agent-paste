# Publish Is Content-Only and Private-First; Going Public Is a Separate Step

> **Planned terminology amendment:** [ADR 0087](./0087-public-artifacts-and-unlisted-share-links.md)
> reserves **Public Artifact** for a future CDN-backed public distribution model
> and reclassifies the current Share Link handoff as unlisted. Until that model is
> implemented, this ADR still describes shipped CLI/MCP behavior: `make_public`
> and `agent-paste make-public` mint or reuse the Artifact's one Share Link.

agent-paste is private-first: an **Artifact** is for its owner until they decide
otherwise. The publish surfaces must honor that by default and never expose anything
by URL that the caller did not explicitly ask to expose.

[ADR 0085](./0085-publish-returns-one-viewer-url.md) tried to keep "one link" simple
by making the returned `viewer_url` _switch_ between the authenticated **Private
Link** (when private) and the public **Share Link** (when shared), surfaced through a
`shared` boolean and a `share` input on publish. Two problems showed up in real use:

1. **It lied.** Because the Private Link and the Share Link are _different URLs_, the
   returned link changed when visibility changed. Revising an artifact without
   re-passing `share` reported `shared:false` and handed back a different URL, even
   though a live public Share Link was still serving the page. The output described
   the call, not the artifact, and read as "now private" when it was not.
2. **It defaulted to surprise.** `share` as a publish flag put visibility on the
   content path, so making something public was one easy flag away on every publish —
   and an agent that set it once made the artifact world-readable by URL. On a
   private-first product, visibility does not belong on the content-publish call.

## Decision

- **Publish is content-only and private-first.** `publish_artifact`, `add_revision`,
  and `agent-paste publish` accept no visibility input and have no concept of public.
  They return exactly one link — the **Private Link** — and the `share`/`--share`
  inputs and the `shared` output bit are removed from every surface (CLI, MCP, the
  REST `PublishRevisionRequest` body, and the shared `runPublish` module).
- **The Private Link is a clean viewer, never the console.** It resolves to
  `/v/<artifactId>` — a login-walled clean viewer for the owning **Workspace Member**,
  with no management chrome. It is returned as `private_url`. The dashboard-only
  **Artifact Console** at `/artifacts/<artifactId>` (the management page) is never
  returned by any publish or agent surface.
- **The Private Link is permanent, stable, and always private.** The URL is derived
  only from the Artifact id — no token, signature, or expiry — and `add_revision`
  republishes into the same id, so the link never changes across revisions and
  live-updates to the latest Published Revision. It is member-only (publish never
  grants unauthenticated access) and stops resolving only when the Artifact itself
  is deleted or swept by Auto Deletion. The `expires_at` in the publish response
  is the Artifact's content lifetime, not a link expiry. The mental model: a
  permanent, private, internal link that is always there; unauthenticated sharing
  is a separate, revocable Share Link.
- **Creating unauthenticated access is a separate, explicit verb.** `make_public`
  (MCP) and `agent-paste make-public` (CLI), replacing `create_share_link`, mint or
  reuse the one revocable **Share Link** (`access_links.type='share'`) and return
  its no-login **Access Link Signed URL**. This is the only way an Artifact becomes
  reachable without login.
- **Revocation is independent of content.** `revoke_access_link` kills a Share Link
  (or Revision Link) without touching the Artifact, its data, its revisions, or its
  Private Link. `list_access_links` and `create_revision_link` remain, so the owner
  keeps full control of links and snapshots.
- **Two link types, two security boundaries, no unifying field.** The Private Link is
  an auth-gated app route — no `access_links` row, nothing signed, nothing to revoke
  (you revoke membership, not the link). Share/Revision Links are signed, revocable,
  by-URL public grant rows. The deleted `viewer_url`/`shared` convention is not
  reintroduced.

## Considered Options

- **Keep ADR 0085's one switching `viewer_url` + `shared` bit.** Rejected: it is the
  source of both the dishonest revise output and the public-by-flag default.
- **Make the Private Link a new `access_links` row type (e.g. `type:'private'`).**
  Rejected. The `access_links` table's single responsibility is _revocable, by-URL,
  unauthenticated grants_. A private, auth-gated, non-revocable link violates every
  invariant the table enforces, and gating a `type:'private'` link inside the public
  `/al/` resolve endpoint adds an auth branch to the most security-sensitive file in
  the system — one slipped conditional silently makes a "private" link publicly
  resolvable. The Private Link is just an `_authed` route; the public resolve gate is
  left untouched, so existing Share Links keep working and there is no new leak path.
- **Auto-mint a Share Link on every publish (always public).** Rejected outright: it
  is the private-first violation this ADR exists to remove.

## Consequences

- **The MCP/CLI publish output drops `shared` and renames `viewer_url`/`artifact_url`
  to `private_url`.** Pre-launch break with no compatibility shim; CLI and MCP are the
  only callers and ship in lockstep. The server `PublishResult` no longer carries
  `access_link_url`.
- **`create_share_link` is renamed `make_public`** (MCP) with a matching
  `agent-paste make-public` CLI command; the go-public action reads as the deliberate
  step it is and pairs with `revoke_access_link`. No separate `revoke_public` verb is
  added (one way to do one thing).
- **A new authed clean-viewer route** `/v/<artifactId>` is added to `apps/web`,
  sharing one `ArtifactLiveViewer` component with the console. It must ship before the
  publish output repoints at it.
- **Vocabulary shrinks** to **Private Link** (what publish returns) and **Share Link**
  (what `make_public` creates). [`CONTEXT.md`](../../CONTEXT.md) deletes **Viewer URL**,
  renames **Artifact URL** to **Artifact Console**, and retargets **Private Link** at
  the `/v` viewer. Amends [ADR 0084](./0084-cli-and-mcp-share-one-publish-path.md)'s
  output-shape note (`{title, private_url, expires_at, upload_stats?}`, no `shared`).
- **The Access Link grant model is unchanged.** [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md)
  still governs the `/al/<publicId>#blob` Share/Revision Links; only what publish
  returns and where visibility lives change.

## What this ADR is not

- Not a change to how a public Share Link works once created — it is the same
  revocable, fragment-self-auth Access Link Signed URL as before.
- Not a removal of the management console. `/artifacts/<id>` still exists for owners in
  the dashboard; it is simply never the link handed to a user or agent.
