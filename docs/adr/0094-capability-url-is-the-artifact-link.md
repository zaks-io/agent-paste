# The Capability URL Is the Artifact Link

Status: Accepted and implemented. Supersedes the Share Link surface of [ADR 0086](./0086-publish-is-content-only-private-first.md), amends [ADR 0093](./0093-capability-scoped-content-origins.md), and retires the app-wrapped viewer decided in [ADR 0014](./0014-single-domain-with-hardened-content-subdomain.md). Its domain and all-tiers-open-CSP decisions are amended by [ADR 0095](./0095-isolate-active-content-and-restore-ephemeral-execution-policy.md), and its new-ID encoding is amended by [ADR 0096](./0096-shorter-base32-capability-ids.md).

Publishing returns exactly one URL, and that URL is the capability origin itself:

```text
https://{32-lowercase-hex-id}.agent-paste.link/
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
   Revision. The ID is 16 cryptographically random bytes generated with
   `crypto.getRandomValues`, independent of Artifact or Revision identifiers,
   and encoded as all 32 lowercase hexadecimal characters. The link survives
   revisions; a revise updates the same URL. Revoke deletes the manifest and
   mints a fresh capability on the next publish.
2. **Top-level serving with tier-selected scripts.** The content Worker serves
   capability-host requests as ordinary top-level documents. The fetch-metadata
   inert-copy mode is removed; a copied URL is the link, not a leak. Capability
   responses still deny framing with `frame-ancestors 'none'` and
   `X-Frame-Options: DENY`, as specified in
   [Content Rendering](../specs/content-rendering.md). ADR 0095 restores the
   `script_disabled` override for ephemeral publishes.
3. **Open claimed-content CSP.** Scripts, styles, fonts, images, media, and
   `connect-src` allow HTTPS sources plus inline and evaluated scripts. Response hardening that
   does not restrict artifact behavior stays: `nosniff`, no-referrer,
   `x-robots-tag: noindex` for ephemeral, the denylist, rate limits, and the
   generic 404. ADR 0095 applies a separate restricted CSP to ephemeral content
   and blocks service workers on every tier.
4. **`/al` access links are removed now.** The web route, the resolve endpoint,
   the access-link live-update endpoints, and Share Link minting are deleted.
   Existing `/al` links stop resolving; this is an explicit breaking change for
   a live early-alpha surface. The member console keeps artifact management and
   displays the capability link. Legacy `/v/{token}/{path}` and `/b/{token}`
   content URLs continue to expire naturally.
5. **Lifecycle follows the Artifact.** Unpinned capability tokens carry the
   Artifact expiration. Pinned capability tokens carry `exp: null`, a signed
   explicit no-expiration value accepted only by the content-token verifier;
   the denylist remains the immediate revocation control. Pin and unpin rewrite
   the existing manifest after their database transition without changing the
   capability ID: pin writes `exp: null`, while unpin restores the Artifact's
   finite expiration. Revise also overwrites that same manifest with the latest
   Revision and current lifecycle state.

   The broad 91-day R2 lifecycle rule for `content-capabilities/v1/` is removed
   before durable capability links ship because it cannot distinguish pinned
   manifests. Artifact expiration, revoke, and delete write the denylist first,
   then delete the stored manifest through the existing retryable lifecycle
   cleanup path. This makes a pinned URL durable beyond 91 idle days while an
   expired ephemeral URL returns the generic 404 after its 24-hour Artifact TTL.

## Considered Options

- **Keep the app viewer and keep patching CORS/framing edge cases.** Each fix
  (root-relative escapes, opaque-origin CORS, Tailwind hash paths, sandboxed
  navigation, clipping) removed one instance of a structural class. The class
  itself only dies by removing the iframe indirection.
- **Keep `/al` as a wrapper that frames the capability origin.** Preserves the
  brand bar and live-update push at the cost of retaining the entire framing
  and sandbox surface this ADR exists to delete, and two ways to view one
  artifact.
- **Separate registrable usercontent domain.** Initially deferred, then adopted
  by ADR 0095 as `agent-paste.link` before a growth push.

## Consequences

- One URL, one behavior: what the agent gets back is what a human opens.
  Revision updates repoint the same hostname, so the long-standing
  republish-strands-the-viewer problem disappears.
- The private-first model of ADR 0086 is superseded: every publish is
  reachable by its unguessable URL without a separate share bit. The member-only
  `/artifacts/{artifact-id}` console remains login-walled for management.
- Artifacts execute with a real per-capability origin on the separate
  `agent-paste.link` site. Product cookies are never sent to them.
- The capability hostname remains visible to DNS, SNI, and browser history, as
  accepted in ADR 0093. It is now the entire secret rather than defense in
  depth.
- Live-update push and the access-link brand bar are removed with `/al`.
  Refresh shows the current Revision.
- The CLI and MCP publish contracts change shape (single `url`), which requires
  a CLI version bump and release, and updated agent guidance on every surface:
  the stable-link promise is now native, so "revise in place, same URL" replaces
  republish guidance.
- The live early-alpha `/v1` publish response is intentionally reset in place
  under this accepted breaking change. A parallel legacy response would retain
  the removed viewer and Access Link vocabulary and create two publish
  contracts for the same operation. CLI JSON moves to schema version 2.
