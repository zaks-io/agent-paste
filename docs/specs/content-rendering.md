# Content Rendering Spec

The `content` Worker serves untrusted artifact files from `usercontent.agent-paste.sh`. It reads private R2 objects and a KV denylist. It has no Hyperdrive binding.

## URL Shape

| Shape               | Meaning                                      |
| ------------------- | -------------------------------------------- |
| `/v/{token}/{path}` | File bytes for one signed artifact revision. |

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

Unknown extensions are served as `application/octet-stream` with `Content-Disposition: attachment`.

## Base Security Headers

Every untrusted-content response carries:

```text
Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
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

## Render Modes

MVP has no platform renderer pages. The primary supported entrypoint is HTML:

| Entrypoint               | Viewer URL              | Notes                                                                  |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------- |
| Single `.html` file      | `/v/{token}/{file}`     | Direct file response.                                                  |
| Folder with `index.html` | `/v/{token}/index.html` | Direct file response; relative assets load from the same signed token. |

Markdown and text files may be included as downloadable files. Dedicated Markdown/text renderers are future work.

## Caching

After token verification, cache by `(artifact_id, revision_id, path)`. Responses carry `Cache-Control: private, max-age={remaining_token_seconds}`.

Stable public signed URLs are not immutable forever. They expire at or before artifact expiration.
