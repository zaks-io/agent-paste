# Content Rendering Spec

The `content` Worker serves each Artifact as a top-level website on one
capability-scoped origin:

```text
production  https://{32-lowercase-hex-id}.agent-paste.sh/
preview     https://{32-lowercase-hex-id}-preview.agent-paste.sh/
```

There is no application viewer, iframe, sandbox, brand-bar wrapper, or separate
sharing step. The capability hostname is the URL returned by every publish.

## Capability routing

The API generates 16 cryptographically random bytes on an Artifact's first
publish and stores the 32-character lowercase hexadecimal ID with it. Revise,
pin, and unpin keep that ID. Revocation clears it, and the next publish mints a
new random ID. The ID is independent of the Artifact and Revision IDs. It is an
unguessable bearer locator.

The API writes an R2 manifest at `content-capabilities/v1/{id}.json`. The
manifest contains the entrypoint and a signed content token with the Artifact,
Revision, expiration, noindex policy, and allowed path-to-object map. Publishing
a later Revision rewrites the same manifest, so the Artifact URL does not
change. Claiming also rewrites the manifest immediately after reparenting, so
the same URL uses the destination Workspace's copied object keys and retention
deadline without waiting for a dashboard read. Pin, unpin, revoke, expiration,
and delete update or remove that manifest through the existing lifecycle path.

The content Worker accepts only the configured hostname shape. Production uses
the wildcard Worker route `*.agent-paste.sh/*`. Cloudflare Routes execute before
Custom Domains on the same hostname, so the Worker forwards the explicit
`api`, `app`, `mcp`, `stream`, and `upload` hosts to their existing Custom
Domain origins. Every other hostname that does not match the capability grammar
is rejected. Preview uses `*-preview.agent-paste.sh/*`, which does not overlap
the `*.preview.agent-paste.sh` product hosts.

`/` resolves to the manifest entrypoint. Every other path resolves within the
same manifest. This gives uploaded HTML, CSS, JavaScript, fonts, images, module
imports, and root-relative URLs a normal same-origin directory-hosting model.

## Browser execution policy

Capability pages are ordinary top-level documents with scripts enabled. Their
Content Security Policy is deliberately compatibility-oriented:

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
HTTPS dependencies, data and blob assets, workers, fetch, and secure WebSockets.
`frame-ancestors 'none'` prevents another site from putting an Artifact back
inside an iframe. The policy is selected only after strict capability-host
resolution; callers cannot opt into it with a header.

Capability responses also carry `Referrer-Policy: no-referrer`,
`X-Content-Type-Options: nosniff`, restrictive `Permissions-Policy`,
`Cross-Origin-Opener-Policy: same-origin`, and
`Cross-Origin-Resource-Policy: cross-origin`. Ephemeral Artifacts carry
`X-Robots-Tag: noindex`.

The WorkOS session cookie is host-only and is not sent to Artifact hosts. The
parent-scoped theme and analytics preference cookies are non-sensitive.

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
`Cache-Control: private, no-cache`. A matching `If-None-Match`, including `*`,
returns `304 Not Modified` before the R2 read, after authorization, denylist,
and rate-limit checks. The 304 carries the same content type, CSP, ETag, and
cache policy as the corresponding 200.

Errors use `Cache-Control: no-store`. Revising an Artifact changes validators
without changing its hostname.

## Legacy URLs

Previously issued `https://usercontent.agent-paste.sh/v/{token}/{path}` and
`/b/{token}` URLs retain their old exact-Revision behavior and security policy
until their signed tokens expire. New publish results never return them.
