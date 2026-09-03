# Content Rendering Spec

The `content` Worker serves each Artifact as a top-level website on one
capability-scoped origin:

```text
production  https://{xxxxx-xxxxx-xxxxx-xxxxx}.agent-paste.link/
preview     https://{xxxxx-xxxxx-xxxxx-xxxxx}-preview.agent-paste.link/
```

There is no application viewer, iframe, sandbox, brand-bar wrapper, or separate
sharing step. The capability hostname is the URL returned by every publish.

## Capability routing

The API generates 19 random Crockford-base32 symbols on an Artifact's first
publish, appends a check symbol, and stores the 23-character
`xxxxx-xxxxx-xxxxx-xxxxx` ID with it. The random symbols carry 95 bits of
entropy. Revise, pin, and unpin keep that ID. Revocation clears it, and the next
publish mints a new random ID. The ID is independent of the Artifact and
Revision IDs. It is an unguessable bearer locator. Legacy 32-character
lowercase hexadecimal IDs remain valid and are never rewritten.

The API writes an R2 manifest at `content-capabilities/v1/{id}.json`. The
manifest contains the entrypoint and a signed content token with the Artifact,
Revision, expiration, noindex policy, and allowed path-to-object map. Publishing
a later Revision rewrites the same manifest, so the Artifact URL does not
change. Claiming also rewrites the manifest immediately after reparenting, so
the same URL uses the destination Workspace's copied object keys and retention
deadline without waiting for a dashboard read. Pin, unpin, revoke, expiration,
and delete update or remove that manifest through the existing lifecycle path.

The content Worker accepts only the configured hostname shape. Production uses
`*.agent-paste.link/*`; preview uses `*-preview.agent-paste.link/*`. Product,
authentication, API, upload, and MCP hosts remain on the separate
`agent-paste.sh` site. The old `.sh` wildcard routes remain temporarily so exact
legacy capability hosts can redirect to the equivalent `.link` host. Existing
product hosts are forwarded through an explicit allowlist while that migration
route exists. Every other wildcard hostname fails closed.

`/` resolves to the manifest entrypoint. Every other path resolves within the
same manifest. This gives uploaded HTML, CSS, JavaScript, fonts, images, module
imports, and root-relative URLs a normal same-origin directory-hosting model.

## Browser execution policy

Capability pages are ordinary top-level documents. Claimed Artifacts use a
compatibility-oriented Content Security Policy:

```text
default-src 'self' data: blob: https:;
script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:;
style-src 'self' 'unsafe-inline' data: blob: https:;
font-src 'self' data: blob: https:;
img-src 'self' data: blob: https:;
connect-src 'self' data: blob: https: wss:;
media-src 'self' data: blob: https:;
worker-src 'self' blob: https:;
frame-ancestors 'none'
```

This permits inline Tailwind configuration, the Tailwind CDN runtime, external
HTTPS dependencies, data and blob assets, dedicated Web Workers, fetch, and secure WebSockets.
`frame-ancestors 'none'` prevents another site from putting an Artifact back
inside an iframe. The policy is selected only after strict capability-host
resolution and a verified token-carried execution-policy bit; callers cannot opt
into it with a header.

Ephemeral Artifacts fail closed to this restricted policy:

```text
default-src 'none';
script-src 'none';
style-src 'self' 'unsafe-inline' data: blob: https:;
font-src 'self' data: blob: https:;
img-src 'self' data: blob: https:;
connect-src 'none';
media-src 'self' data: blob: https:;
worker-src 'none';
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none'
```

This keeps static HTML, styles, images, fonts, and media usable while blocking
scripts, scripted connections, form submission, workers, embedded browsing
contexts, plugin content, and base-URL rewriting. Remote static resources can
still receive the viewer's request, but `Referrer-Policy: no-referrer` keeps the
capability URL out of those requests. Claiming rewrites the manifest with the
claimed execution policy.

Service workers are unsupported on every tier because they can outlive Revision
and lifecycle changes. A `Service-Worker: script` request receives a no-op
self-retiring worker plus `Clear-Site-Data`; ordinary dedicated Web Workers on a
claimed Artifact remain governed by the claimed CSP.

Capability responses also carry `Referrer-Policy: no-referrer`,
`X-Content-Type-Options: nosniff`, restrictive `Permissions-Policy`,
`Cross-Origin-Opener-Policy: same-origin`, and
`Cross-Origin-Resource-Policy: cross-origin`. Ephemeral Artifacts carry
`X-Robots-Tag: noindex`.

The WorkOS session and parent-scoped product preference cookies belong to the
separate `agent-paste.sh` site and are not sent to Artifact hosts.

## Content types and storage

The served content type comes from a fixed extension allowlist, not the upload's
claimed MIME type. Unknown extensions use `application/octet-stream`. PDFs are
attachments. Supported HTML, CSS, JavaScript, images, fonts, audio, video, text,
and SVG are served inline.

Artifact bytes remain encrypted in private R2. The content Worker has no
database binding. It verifies the manifest's signed token, expiration, scope,
denylist keys, requested-path allowlist, and workspace-bound object key before
reading and decrypting a file. Authorization failures return the generic
`404 { "code": "not_found" }` response.

## Caching

Every successful file response has a strong Revision-and-path `ETag` and
`Cache-Control: private, no-cache, no-transform`. `no-transform` prevents the
outer Cloudflare zone from injecting analytics or other markup into uploaded
HTML. A matching `If-None-Match`, including `*`, returns `304 Not Modified`
before the R2 read, after authorization, denylist, and rate-limit checks. The
304 carries the same content type, CSP, ETag, and cache policy as the
corresponding 200.

Errors use `Cache-Control: no-store`. Revising an Artifact changes validators
without changing its hostname.

## Legacy URLs

Previously issued `https://usercontent.agent-paste.sh/v/{token}/{path}` and
`/b/{token}` URLs retain their old exact-Revision behavior and security policy
until their signed tokens expire. New publish results never return them.
Existing capability hosts below `agent-paste.sh` redirect to the same Capability
ID and path below `agent-paste.link` during migration.
