# The Capability URL Is the Artifact Link

Status: Accepted. Supersedes the Share Link surface of [ADR 0086](./0086-private-first-publish-with-share-links.md), amends [ADR 0093](./0093-capability-scoped-content-origins.md), and retires the app-wrapped viewer decided in [ADR 0014](./0014-single-domain-with-hardened-content-subdomain.md).

Publishing returns exactly one URL, and that URL is the capability origin itself:

```text
https://{32-lowercase-hex-id}-uc.agent-paste.sh/
```

The document opens top-level as a first-class page with a real origin. There is no
app viewer iframe, no sandbox, no `/al` access-link surface, and no separate
"make public" step. Privacy is the 128 bits of hostname entropy plus revocation.

## Context

The app-wraps-content-in-a-sandboxed-iframe architecture produced a recurring
class of viewer failures: the sandbox's opaque origin turned every artifact
subresource fetch into an `Origin: null` CORS request, framing required CSP
choreography on both the app and content responses, direct navigation needed a
separate inert response mode, and the viewport-pinned iframe clipped any
artifact taller than one screen. Separately, the content CSP's named-CDN
allowlist silently broke any artifact referencing an unlisted host, and
agent-authored HTML carrying `integrity`/`crossorigin` attributes failed on CDNs
that do not serve CORS headers. The combined effect was that the primary use
case, an agent publishing a self-contained HTML document that just renders,
routinely did not.

## Decision

1. **Durable capability per Artifact.** A capability ID is minted once at first
   publish, stored on the Artifact, and its R2 manifest is repointed at each new
   Revision. The link survives revisions; a revise updates the same URL. Revoke
   deletes the manifest and mints a fresh capability on the next publish.
2. **Top-level serving with scripts enabled.** The content Worker serves
   capability-host requests as ordinary top-level documents. The fetch-metadata
   inert-copy mode and `frame-ancestors`/`x-frame-options` special-casing are
   removed; a copied URL is the link, not a leak. Ephemeral publishes lose the
   `script_disabled` override and render like any other artifact.
3. **Fully open content CSP.** Scripts, styles, fonts, images, media, and
   `connect-src` allow any `https:` source plus inline. Response hardening that
   does not restrict artifact behavior stays: `nosniff`, no-referrer,
   `x-robots-tag: noindex` for ephemeral, the denylist, rate limits, and the
   generic 404. Abuse control is the denylist and the scan strategy, not CSP.
4. **Publish-time HTML normalization.** `integrity` and `crossorigin`
   attributes are stripped from `<script>` and `<link>` tags in uploaded HTML at
   finalize, and the strip is reported in the publish response's warnings.
   Subresource integrity requires CORS-enabled responses; popular CDNs
   (`cdn.tailwindcss.com` among them) serve none, so these attributes are a
   guaranteed break that authoring agents emit as reflexive best practice.
5. **`/al` access links are removed now.** The web route, the resolve endpoint,
   the access-link live-update endpoints, and Share Link minting are deleted.
   Existing `/al` links stop resolving; this is an explicit breaking change for
   a live early-alpha surface. The member console keeps artifact management and
   displays the capability link. Legacy `/v/{token}/{path}` and `/b/{token}`
   content URLs continue to expire naturally.
6. **Lifecycle.** Ephemeral capabilities expire with their 24-hour Artifact TTL
   and are cleaned by the existing expiry job plus the 91-day R2 manifest
   lifecycle rule. Account publishes carry the standard Artifact TTL; pinning an
   Artifact re-mints its manifest so the same URL stays live indefinitely.

## Considered Options

- **Keep the app viewer and keep patching CORS/framing edge cases.** Each fix
  (root-relative escapes, opaque-origin CORS, Tailwind hash paths, sandboxed
  navigation, clipping) removed one instance of a structural class. The class
  itself only dies by removing the iframe indirection.
- **Keep `/al` as a wrapper that frames the capability origin.** Preserves the
  brand bar and live-update push at the cost of retaining the entire framing
  and sandbox surface this ADR exists to delete, and two ways to view one
  artifact.
- **Separate registrable usercontent domain.** The standard isolation posture
  once artifacts execute top-level scripts, because Safe Browsing flags apply to
  the registrable domain. Deferred, not rejected: capability hosts stay on
  `*-uc.agent-paste.sh` for now, and the deferred risk is that one abusive
  artifact can reputation-flag `agent-paste.sh` itself. Revisit before any
  growth push.
- **Serve-time attribute rewriting instead of publish-time.** Rewriting on
  every response repeats work and complicates caching; normalizing once at
  finalize keeps stored content deterministic and the strip visible in the
  publish response.

## Consequences

- One URL, one behavior: what the agent gets back is what a human opens.
  Revision updates repoint the same hostname, so the long-standing
  republish-strands-the-viewer problem disappears.
- The private-first model of ADR 0086 is superseded: every publish is
  reachable by its unguessable URL without a separate share bit. The member-only
  `/v/{artifact-id}` console URL remains login-walled for management.
- Artifacts execute with a real per-capability origin. Nothing sensitive lives
  on those origins; the host-only session cookie is never sent to them. The
  parent-scoped theme/analytics cookies are readable by artifact scripts and are
  accepted as non-sensitive.
- The capability hostname remains visible to DNS, SNI, and browser history, as
  accepted in ADR 0093. It is now the entire secret rather than defense in
  depth.
- Live-update push and the access-link brand bar are removed with `/al`.
  Refresh shows the current Revision.
- The CLI and MCP publish contracts change shape (single `url`), which requires
  a CLI version bump and release, and updated agent guidance on every surface:
  the stable-link promise is now native, so "revise in place, same URL" replaces
  republish guidance.
