# Public Artifacts and Unlisted Share Links

Status: Planned. Current shipped CLI/MCP behavior still treats `make_public` /
`agent-paste make-public` as Share Link minting until the implementation specs
and routes are updated.

## Context

ADR 0086 made publish private-first and moved unauthenticated handoff into a
separate `make_public` step that mints the Artifact's one revocable Share Link.
That fixed accidental public-by-flag publishing, but it reused "public" for two
different jobs:

- unlisted, revocable handoff to a specific audience
- broad public distribution that should survive traffic spikes and benefit from
  aggressive edge caching

Those jobs have different control and caching expectations. A user iterating on
an Artifact may need a no-login URL that can be revoked cleanly. A user sharing a
finished Artifact with many people needs a stable permalink and CDN-shaped cost
profile. Treating both as "public" makes the product and implementation lie.

## Decision

- **Share Links are unlisted.** A Share Link remains an Access Link that follows
  the latest Published Revision, opens the Artifact Viewer, and can receive Live
  Updates. It is the control-oriented unauthenticated path: revocable,
  expirable, not a permalink, and not the aggressive edge-cache surface.
- **Public Artifacts are a separate planned distribution model.** A Public
  Artifact has a stable ID-only Public URL shaped `/p/{publicId}`. The Public ID
  is separate from the Artifact id and has no slug.
- **The first public action is atomic.** It allocates the Public ID, creates the
  Public URL, and selects the initial Public Version in one durable action.
  There is no reserved Public URL state before the first Public Version is
  selected.
- **Public Versions are frozen.** A Public Version points at one Published
  Revision. Ordinary Publish Updates do not move it. Moving the public pointer is
  an explicit action available to Agent Credentials with publish Scope.
- **Public Offline is soft.** Clearing the selected Public Version keeps the
  Public URL and Public ID reserved while stopping the Public Resolver from
  serving broad public content. It is for owner/agent control, not hard abuse or
  legal takedown.
- **Public Resolver and Public Version Assets are separate cache surfaces.** The
  Public Resolver is mutable and must change quickly through short cache lifetime
  or explicit purge. Public Version Assets are immutable for one Published
  Revision and are the aggressive edge-cache surface for broad traffic.
- **Platform Lockdown is the hard public takedown path.** Operator-only Platform
  Lockdown blocks the Public Resolver and Public Version Assets, using cache
  purge and deny controls where available. It remains distinct from Access Link
  Lockdown and Public Offline.
- **Public pointer changes are audit-worthy.** Public Version changes and Public
  Offline changes create Audit Events with a redacted Change Summary containing
  the Public ID, old and new Published Revision ids or null, actor, and calling
  surface.

## Consequences

- The current `make_public` / `agent-paste make-public` name becomes misleading:
  it creates an unlisted Share Link today, not the future Public Artifact model.
  A follow-up implementation should choose explicit verbs before shipping true
  public distribution, for example `share` / `create_share_link` for unlisted and
  `make_public` / `select_public_version` for true public.
- Existing shipped specs and user docs remain current until that implementation
  lands: publish is private-first, Share Link creation is explicit, and Access
  Link Signed URLs remain the only shipped no-login latest-moving handoff.
- The Public Artifact model needs schema, API, CLI, MCP, cache, audit, and
  operator-lockdown work before it can be described as shipped behavior in
  `docs/specs/`.
- Public should be chosen for broad distribution and traffic spikes. Unlisted
  Share Links should be chosen when revocation and takedown control matter more
  than cache-level distribution.

## Considered Options

- **Keep calling Share Links public.** Rejected. It hides the cache and
  revocation tradeoff and makes CDN-backed distribution sound safer to revoke
  than it is.
- **Use signed URLs for public distribution.** Rejected. Signed URLs are the
  right shape for unlisted grants, but broad public distribution needs a stable
  permalink and immutable cacheable assets.
- **Let Publish move the public pointer automatically.** Rejected. Public
  versions should be frozen so the public page does not live-update while an
  agent iterates.
- **Add slugs to Public URLs.** Rejected for the canonical URL. Slugs create
  uniqueness and rename concerns without adding enough product value. The Public
  ID is the canonical segment.

## What this ADR is not

- Not an implementation of Public Artifacts.
- Not a change to the current Access Link Signed URL model from ADR 0047.
- Not a change to the current shipped `make_public` command until a follow-up
  spec and implementation PR changes it.
