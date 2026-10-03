# Bounded Browser Cache for Static Assets

Status: Accepted. Partially supersedes ADR 0020 and ADR 0081.

## Context

Image-heavy uploaded sites reuse images between pages. Uniform `no-cache`
forced a conditional request for every asset on every navigation. ETags saved
bandwidth but each 304 still consumed the Artifact and capability lookup limits.
Normal browsing could exhaust the original read budget.

## Decision

Inline images, CSS, JavaScript, fonts, audio, and video get private browser
freshness for up to 3600 seconds, capped by signed token expiry. HTML, data,
text, attachments, and bundles still revalidate on every load. All successful
responses remain `private` and `no-transform`; static assets also use
`must-revalidate` to prevent reuse after freshness expires without a network
check. Errors remain `no-store`. MIME and disposition come from the existing
storage classifier.

This uses standard [HTTP cache directives](https://www.rfc-editor.org/rfc/rfc9111#section-5.2.2),
not an edge cache. ETag validation and security checks remain unchanged for
network requests. Fresh browser cache hits make no request and spend no read
budget.

## Consequences

Stable URLs permit cached assets and their security headers to lag revisions,
revocation, deletion, lockdown, denylisting, claims, and retention changes by up
to one hour or the originally signed expiry if sooner. New HTML revalidates
on navigation and may temporarily reference older cached assets. A hard refresh
forces revalidation. The platform cannot recall already displayed or cached
bytes. Shared caching, immutable asset URLs, and HTML rewriting are outside this
change.

The current contract is [Content Rendering](../specs/content-rendering.md#caching).
