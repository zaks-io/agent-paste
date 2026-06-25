# Content Rendering Spec

The `content` Worker serves untrusted artifact files from `usercontent.agent-paste.sh`. It reads private R2 objects and a KV denylist. It has no Hyperdrive binding. The content origin is a byte delivery origin, not the product viewer: direct top-level `usercontent` navigations are always inert and unbranded.

Content URLs are delivery URLs for exact Revisions, not Access Links. A URL
shaped `/v/{token}/{path}` never advances to a newer Revision after another
publish. Latest-moving public viewers start from an Access Link Signed URL
minted from a Share Link, which opens the Artifact Viewer.
Artifact URLs are authenticated workspace management URLs, not recipient handoff
URLs.

## URL Shape

| Shape               | Meaning                                      |
| ------------------- | -------------------------------------------- |
| `/v/{token}/{path}` | File bytes for one signed artifact Revision. |

The token is an opaque signed content token minted during publish. Content tokens
live in the URL path. Access Link Signed URLs use a separate
`/al/{publicId}#{blob}` shape on the app origin and resolve to signed content
tokens.

## Token Checks

For every request, `content` verifies:

- Token parse and signature.
- Token expiration.
- Token scope.
- KV denylist keys for artifact and revision when present.
- Requested path is within the signed revision.

Authorization failures return `404 { "error": { "code": "not_found" } }`. Artifact read rate-limit failures return `429 { "error": { "code": "rate_limited_artifact" } }` with `Retry-After`.

Internal logs may record the failure category and resolved ids, but must never record the token or full signed URL.

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
| `.svg`             | `image/svg+xml` plus SVG-specific CSP   |
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

Content tokens carry `script_disabled`, but the response still fails closed at
request time. A response may use the interactive script policy only when all of
these are true:

- The token explicitly has `script_disabled: false`.
- The current environment has a trusted app viewer origin.
- Browser fetch metadata says this is an iframe navigation
  (`Sec-Fetch-Dest: iframe` or `frame`, with `Sec-Fetch-Mode: navigate` when
  present).
- `Sec-Fetch-Site`, when present, is `same-site` or `same-origin`.

Every other HTML document request, including a copied top-level
`usercontent.agent-paste.sh/v/.../index.html` URL, receives the script-disabled
CSP:

```text
Content-Security-Policy: default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

This means `usercontent` can still serve raw HTML/CSS/JS/image bytes for one
Revision, but a browser only executes an HTML Artifact as an interactive page
inside the controlled Artifact Viewer iframe on the app origin.

When the interactive policy is selected, `script-src` allows only `'self'`,
inline/eval execution, and these CDN origins: `https://cdn.jsdelivr.net`,
`https://unpkg.com`, `https://cdnjs.cloudflare.com`, `https://esm.sh`, and
`https://cdn.tailwindcss.com`.

## Base Security Headers

Every untrusted-content response carries a CSP selected by the execution policy
above, plus these baseline headers:

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()
X-Content-Type-Options: nosniff
Cross-Origin-Resource-Policy: cross-origin
Cross-Origin-Opener-Policy: same-origin
```

SVG responses override CSP with:

```text
Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:
```

### Sandboxed asset fetches

The Artifact Viewer iframe is sandboxed without `allow-same-origin`, so browser
scripts inside it have an opaque origin serialized as `Origin: null`. Signed
content file `200`/`304` responses echo `Access-Control-Allow-Origin: null`
only for that exact request origin and add `Vary: Origin`. They do not set
credentialed CORS headers, do not echo ordinary web origins, and still require
the requested path to be listed in the signed content token. This lets an
uploaded `index.html` fetch sibling uploaded assets such as `data/latest.json`
from the same signed Revision without opening a general cross-origin read
policy.

### Framing the viewer

The dashboard and Artifact Viewer render artifact content in a sandboxed iframe
(`sandbox="allow-scripts allow-popups"`, never `allow-same-origin`; see [`web.md`](./web.md))
hosted on the app origin, which is a separate hardened origin from this content subdomain
(ADR 0014). To let that one trusted page host the sandbox while still refusing every other
framer, **inline** content responses requested as viewer iframe navigations scope
`frame-ancestors` to the app origin for the current environment and **omit**
`X-Frame-Options` (its origin-blind `DENY` cannot allowlist a single origin, and
`frame-ancestors` supersedes it in modern browsers):

| `AGENT_PASTE_ENV` | `frame-ancestors`                       |
| ----------------- | --------------------------------------- |
| `production`      | `https://app.agent-paste.sh`            |
| `preview`         | `https://app.preview.agent-paste.sh`    |
| `dev`             | local web origins on `5173` and `18991` |
| unset             | `'none'` (XFO `DENY` retained)          |

This relaxation applies only to inline-served content requested as a trusted
viewer iframe navigation. Direct `usercontent` navigations, bundle downloads,
attachments, error envelopes, and non-content routes keep `frame-ancestors
'none'` and `X-Frame-Options: DENY`.

### Viewer iframe height handshake

Trusted viewer iframe navigations for HTML inject a small inline resize reporter
before `</body>` plus an end-marker element. The reporter posts
`{ type: "agent-paste:viewer-height", height }` to the parent via `postMessage`
so the app shell can size the sandboxed iframe and scroll the host page. The
parent accepts messages only from the iframe's `contentWindow` and only when
`event.origin` is the content URL origin or the opaque `"null"` origin produced
by the sandbox.

When the token's script policy is disabled (`script_disabled: true` or a
non-viewer HTML navigation), publisher scripts stay blocked. For viewer-framed
HTML that is still script-disabled, the resize reporter is the sole allowed
script: the content Worker sets `script-src 'sha256-…'` to the reporter's
static source hash and injects that inline script without a nonce. Interactive
viewer-framed HTML (`script_disabled: false`) uses the normal interactive CSP
and an inline reporter allowed by `unsafe-inline`.

## Render Modes

MVP has no platform renderer pages. The primary supported entrypoint is HTML:

| Entrypoint               | Revision Content URL    | Notes                                                                  |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------- |
| Single `.html` file      | `/v/{token}/{file}`     | Direct file response.                                                  |
| Folder with `index.html` | `/v/{token}/index.html` | Direct file response; relative assets load from the same signed token. |

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
object.

Legacy revision files and bundles keep artifact-byte encryption AAD v1:
`workspace_id`, `artifact_id`, `revision_id`, and path. Workspace shared blobs use
AAD v2 bound to `workspace_id` and `sha256`, so the same encrypted blob can be
referenced by multiple Artifacts/Revisions in the workspace without binding
decryption to one Artifact path. The content Worker has no database binding; it
serves whatever object key is carried by the signed token after the allowlist
checks above.

## Caching

Reloads of an unchanged artifact must not re-download bytes. Because a content
token is a deterministic HMAC of its payload and `exp` is fixed from the
artifact's `expires_at`, the signed URL is stable across reloads for the same
`(artifact_id, revision_id, path)`, so the browser cache keys on it correctly.
The content origin adds a validator so an unchanged reload costs a single
zero-body round trip.

**ETag.** Every file and bundle 200 carries a strong `ETag` derived from
immutable revision identity plus any request-scoped HTML representation that
rewrites the body or changes per-path headers. Non-HTML paths hash only
`revision_id` and `path`. HTML paths append a representation suffix that
distinguishes direct navigation vs trusted viewer iframe, noindex injection,
script policy, and whether the resize reporter is present. The value is computed
from the token payload and fetch metadata alone (no R2 read), so a `304` cannot
reuse a cached body from a different framing or script policy.

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

Stable public signed URLs are not immutable forever. They expire at or before
artifact expiration. See ADR 0081.

There is no edge cache (`caches.default`). Caching decrypted bytes near the
worker was considered and deferred — it would persist user plaintext in a shared
edge cache and open a denylist/expiry revocation gap that the `no-cache` posture
exists to close. ADR 0081 records the rationale and the conditions under which to
revisit.
