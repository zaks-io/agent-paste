# Content Rendering Spec

The `content` Worker serves untrusted artifact files from a capability-scoped `{id}-uc.agent-paste.sh` origin. Until production suffix routing is activated, legacy content continues to use `usercontent.agent-paste.sh`. The Worker reads private R2 objects and a KV denylist. It has no Hyperdrive binding. A capability origin is the Artifact's top-level page and scripts are enabled.

One capability URL belongs to an Artifact and advances to its latest Published
Revision. Revising the Artifact rewrites its manifest without changing the
hostname. Legacy `/v/{token}/{path}` URLs remain fixed to one Revision and
expire naturally. Artifact `/v/{artifactId}` URLs remain authenticated workspace
management URLs.

## URL Shape

| Shape                                                 | Meaning                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `https://{capability-id}-uc.agent-paste.sh/{path}`    | Durable Artifact URL and its same-origin files.          |
| `https://usercontent.agent-paste.sh/v/{token}/{path}` | Legacy signed file URL, valid through its normal expiry. |
| `https://usercontent.agent-paste.sh/b/{token}`        | Signed bundle download; unchanged by capability origins. |

The capability ID is 16 cryptographically random bytes encoded as 32 lowercase hexadecimal characters. It is minted once at the Artifact's first publish and stored in `artifacts.capability_id`; the introducing migration backfills IDs for existing published Artifacts. `api` writes `content-capabilities/v1/{id}.json` to R2 before returning the URL. That manifest contains the entrypoint, the opaque signed content token for the current Published Revision, the Revision number, and the Artifact update timestamp. Conditional R2 writes compare those last two fields so a stale publish replay or slower concurrent write cannot roll the manifest backward. The token carries the complete authorization and path scope but does not travel on each browser request.

Production sets `CONTENT_CAPABILITY_DOMAIN=agent-paste.sh` in `api`, `content`, and `web`. Preview leaves it absent and continues to mint the legacy `/v/{token}/{path}` URL because `{id}-uc.preview.agent-paste.sh` needs a deeper wildcard certificate. The content Worker route and hostname parser remain restricted to `*-uc.agent-paste.sh`. During the serialized rollout, existing Access Links retain their `/al/{publicId}#{blob}` shape and resolve through legacy Revision URLs. The `/al` surface is removed in the next rollout step.

## Token Checks

For every capability request, `content` first validates the hostname, loads a bounded versioned manifest from R2, and then performs the same checks as a legacy request:

- Token parse and signature.
- Token expiration. An explicit signed `exp: null` is accepted only for the
  durable manifest of a pinned Artifact.
- Token scope.
- KV denylist keys for artifact and revision when present.
- Requested path is within the signed revision.

Authorization failures return `404 { "error": { "code": "not_found" } }`. Artifact read rate-limit failures return `429 { "error": { "code": "rate_limited_artifact" } }` with `Retry-After`.

Internal logs may record the failure category and non-bearer Artifact and Revision IDs. They must never record capability IDs, capability hosts or paths, manifest tokens, signed URLs, or complete capability URLs.

## Directory URL Semantics

Every file URL in an Artifact shares the same capability origin. `/` maps to the manifest entrypoint. Any other path maps directly to the current Revision path allowlist. Browser-standard root-relative HTML, CSS `url(...)`, JavaScript imports, fonts, images, and generated paths therefore resolve without rewriting content.

The hostname is the bearer capability and the authorization scope. Revising,
pinning, or unpinning rewrites the manifest in place. Revocation deletes the
manifest and the next publish mints a new capability ID.

## Artifact Read Throttling

The content origin applies a platform-controlled unauthenticated read cap per Artifact. The bucket key is derived from the signed token payload after signature verification, not from the raw token or URL.

The throttle covers direct content-origin reads for every file in the Artifact. It is an abuse ceiling, not a billing meter; occasional eventual consistency across Cloudflare locations is acceptable.

When the cap is exceeded or the rate-limit binding is unavailable, `content`
returns the public error envelope with `error.code = "rate_limited_artifact"`
and a `Retry-After` header. It does not reveal whether the Artifact exists
beyond what a valid signed token already proves.

## Extension Allowlist

| Extensions         | Served Content Type                     |
| ------------------ | --------------------------------------- |
| `.html`, `.htm`    | `text/html; charset=utf-8`              |
| `.css`             | `text/css; charset=utf-8`               |
| `.js`, `.mjs`      | `application/javascript; charset=utf-8` |
| `.json`            | `application/json; charset=utf-8`       |
| `.txt`, `.log`     | `text/plain; charset=utf-8`             |
| `.md`, `.markdown` | `text/markdown; charset=utf-8`          |
| `.png`             | `image/png`                             |
| `.jpg`, `.jpeg`    | `image/jpeg`                            |
| `.gif`             | `image/gif`                             |
| `.webp`            | `image/webp`                            |
| `.svg`             | `image/svg+xml`                         |
| `.ico`             | `image/x-icon`                          |
| `.woff`            | `font/woff`                             |
| `.woff2`           | `font/woff2`                            |
| `.mp3`             | `audio/mpeg`                            |
| `.wav`             | `audio/wav`                             |
| `.mp4`             | `video/mp4`                             |
| `.webm`            | `video/webm`                            |
| `.pdf`             | `application/pdf` (served `attachment`) |

All allowlisted extensions are served `Content-Disposition: inline` except `.pdf`, which is served `attachment`: PDFs can carry embedded JavaScript and are a common phishing / XSS vehicle in browser PDF viewers, so they download rather than render in-page. Audio and video stay inline because native media players cannot execute script.

Unknown extensions are served as `application/octet-stream` with `Content-Disposition: attachment`.

## Execution Policy

Capability content is served as an ordinary top-level page with scripts enabled.
The response does not switch policy based on tenant tier, fetch metadata, or
iframe ancestry. All inline-served file types, including SVG, receive the same
artifact CSP:

```text
Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; img-src 'self' data: blob: https:; connect-src 'self' https:; media-src 'self' blob: https:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

During the serialized rollout, legacy `/v/{token}/{path}` requests retain the existing dashboard iframe CSP, frame-ancestor allowance, script-disable behavior, and resize reporter until the viewer is removed. The open policy above is selected only after the Worker has resolved a capability hostname; a caller cannot opt into it with a request header.

The policy permits any HTTPS source for scripts, styles, fonts, images, media,
and fetch connections, plus inline script and style execution. It still blocks
frames, plugins, base URL changes, form submissions, and framing ancestors.

## Base Security Headers

Every untrusted-content response carries the CSP above plus these baseline headers:

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()
X-Content-Type-Options: nosniff
Cross-Origin-Resource-Policy: cross-origin
Cross-Origin-Opener-Policy: same-origin
```

The legacy `Origin: null` CORS response remains temporarily for existing
sandboxed `/al` viewers during the serialized rollout. Capability pages and
their assets are same-origin and do not depend on it.

## Render Modes

MVP has no platform renderer pages. The primary supported entrypoint is HTML:

| Entrypoint               | Revision Content URL                                         | Notes                                                            |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Single `.html` file      | `https://{32-lowercase-hex-id}-uc.agent-paste.sh/{file}`     | Direct file response.                                            |
| Folder with `index.html` | `https://{32-lowercase-hex-id}-uc.agent-paste.sh/index.html` | Relative and root-relative assets load from the same capability. |

Markdown and text files may be included as downloadable files. Dedicated Markdown/text renderers are future work.

## Storage Keys And Encryption

Content tokens may carry an internal `object_key` for a single blob-backed file
URL or an internal `object_keys` map for a revision URL whose relative assets must
load from the same signed token. Public Agent View and `PublishResult` payloads
must not expose those fields; the API strips them after signing the content URL.
The content Worker accepts signed internal object keys only when the requested
path is listed in the token and the key is either the legacy revision object for
`(artifact_id, revision_id, path)` or a workspace blob key whose workspace
matches `workspace_id`. A single `object_key` token is valid for one listed path;
multi-path tokens use `object_keys` so each path resolves to its own stored
object. Capability manifests move these signed fields out of the browser URL; they do not change their meaning or expose them in Agent View.

Capability manifests are plain JSON inside the already-private ARTIFACTS bucket.
Their authorization payload remains HMAC-signed, and `content` verifies that
signature before trusting any scope. One manifest belongs to the Artifact and is
rewritten in place across revise, pin, and unpin. Pin writes a signed content
token with explicit `exp: null`; unpin restores the Artifact's finite
expiration. No broad R2 lifecycle rule applies to the capability prefix.
Expiration, revoke, and delete write the denylist first and then remove the
manifest through the retryable byte-purge queue.

Legacy revision files and bundles keep artifact-byte encryption AAD v1:
`workspace_id`, `artifact_id`, `revision_id`, and path. Workspace shared blobs use
AAD v2 bound to `workspace_id` and `sha256`, so the same encrypted blob can be
referenced by multiple Artifacts/Revisions in the workspace without binding
decryption to one Artifact path. The content Worker has no database binding; it
serves whatever object key is carried by the signed token after the allowlist
checks above.

## Caching

Reloads of an unchanged artifact must not re-download bytes. A capability origin
is stable for the lifetime of the Artifact, and every path under it points to
the current manifest Revision. Legacy tokens remain deterministic for the same
signed payload. Every response carries a validator, so an unchanged reload
inside either URL shape costs a single zero-body round trip.

**ETag.** Every file and bundle 200 carries a strong `ETag` derived from
immutable revision identity plus the request-scoped HTML representation.
Non-HTML paths hash only `revision_id` and `path`. HTML paths append a
representation suffix for `noindex` injection. The value is computed from the
token payload alone, with no R2 read.

**Conditional requests.** A request whose `If-None-Match` matches the ETag (or
is `*`) returns `304 Not Modified` with no body, **before** any R2 read or
decrypt. The 304 MUST carry the same headers the matching `200` would carry —
the same per-path `Content-Security-Policy`, content type, `ETag`, and
`Cache-Control` — minus `Content-Length`. A 304 replaces the cached response's
headers ([RFC 9111 §4.3.4](https://www.rfc-editor.org/rfc/rfc9111#section-4.3.4)),
so a 304 carrying only a permissive baseline CSP would weaken the locked-down
policy of cached untrusted HTML on its next render; building the 304 from the
exact `200` header set is what prevents that drift. The 304 still passes token,
denylist, and artifact-read-limit checks first, and registers a zero-byte read
event.

**Cache-Control.** Every served file and the bundle use the same directive:
`private, no-cache`. Errors use `no-store`. This follows from three best-practice
rules for serving private, bearer-capped, revocable content:

- **Always `private`** — the URL is a bearer cap, so a response MUST NOT enter a
  shared cache.
- **Always `no-cache`, never a no-revalidation `max-age` window** — a content URL
  can be revoked (denylist) or expire at any time, so every load MUST revalidate
  rather than serve from a warm cache that could keep handing back a revoked or
  expired artifact. Paired with the strong ETag, that revalidation is a cheap
  zero-body 304, so the validator (not a `max-age` window) does the
  bandwidth-saving work.
- **`no-store` for errors** — error bodies MUST NOT be cached at all.

Unpinned capability tokens expire at the Artifact expiration, including when an
unpin re-arms an expiration that is already past. Legacy signed file and Bundle
URLs are always time-bounded. Pinned capability tokens use signed `exp: null` and remain valid
until unpin, revoke, delete, or a later manifest rewrite. See ADR 0081 and ADR 0094.

There is no edge cache (`caches.default`). Caching decrypted bytes near the
worker was considered and deferred — it would persist user plaintext in a shared
edge cache and open a denylist/expiry revocation gap that the `no-cache` posture
exists to close. ADR 0081 records the rationale and the conditions under which to
revisit.
