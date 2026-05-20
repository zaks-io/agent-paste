# Content Rendering Spec

The `content` Worker serves **Untrusted Content** and renderer pages from `usercontent.agent-paste.sh`. It has R2 read access and KV denylist read access. It has no Hyperdrive binding.

## URL Shapes

| Shape | Meaning |
|---|---|
| `/v/{token}/{path}` | File bytes for one resolved Revision. |
| `/v/{token}/_render/{mode}?path={path}` | Platform renderer page for a non-HTML mode. Directory rendering is reserved until the listing contract is settled. |
| `/b/{token}` | Bundle bytes for one resolved Revision. |

The token is an opaque signed content-gateway token minted by `api`.

## Token Checks

For every request, `content` verifies:

- Token parse and signature.
- Token expiration.
- Token scope.
- KV denylist keys for workspace, artifact, revision, and Access Link when present.
- Requested path is within the signed Revision.

Authorization failures return the generic `not_found` envelope. Artifact Rate Limit failures return `429 rate_limited_artifact` with `Retry-After`. Internal logs may record the failure reason and resolved ids, but never the token itself.

## Extension Allowlist

| Extensions | Served Content Type |
|---|---|
| `.html`, `.htm` | `text/html; charset=utf-8` |
| `.css` | `text/css; charset=utf-8` |
| `.js`, `.mjs` | `application/javascript; charset=utf-8` |
| `.json` | `application/json; charset=utf-8` |
| `.txt`, `.log` | `text/plain; charset=utf-8` |
| `.md`, `.markdown` | `text/markdown; charset=utf-8` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |
| `.svg` | `image/svg+xml` plus SVG-specific CSP |
| `.pdf` | `application/pdf` |
| `.mp3` | `audio/mpeg` |
| `.wav` | `audio/wav` |
| `.mp4` | `video/mp4` |
| `.webm` | `video/webm` |

Unknown extensions are served as `application/octet-stream` with `Content-Disposition: attachment`.

## Base Security Headers

Every untrusted-content response carries:

```text
Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors https://agent-paste.sh https://app.agent-paste.sh
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

| Render Mode | Viewer URL | Notes |
|---|---|---|
| `html` | `/v/{token}/{entrypoint}` | Direct file response. |
| `markdown` | `/v/{token}/_render/markdown?path={entrypoint}` | Renderer fetches Markdown from same origin and renders client-side. |
| `text` | `/v/{token}/_render/text?path={entrypoint}` | Renderer fetches text and preserves whitespace. |
| `directory` | reserved | Directory listing is not part of the first implementation slice. Until the listing contract below is decided, publishers should provide an explicit file Entrypoint. |
| `image` | `/v/{token}/{entrypoint}` | Direct file response. |
| `audio` | `/v/{token}/{entrypoint}` | Direct file response. |
| `video` | `/v/{token}/{entrypoint}` | Direct file response. |

Renderer pages never call `api` or `web`. They only fetch from `content` with the same signed prefix.

## Directory Listing Open Questions

`content` intentionally has no Hyperdrive binding and renderer pages must not call `api`, so directory rendering needs a file-list source that is available on the content origin after token verification.

Recommended shape: generate a small platform-owned directory listing object during finalize or publish, store it beside the **Revision** bytes in R2, and let the directory renderer fetch that listing through the same content-gateway token. The listing object would contain normalized paths, sizes, served content types, and directory grouping only; it would not become an agent-uploaded file and would not appear in the **Bundle**.

Questions to settle before implementing directory Render Mode:

1. Should `directory` be inferred only when a folder has no obvious file Entrypoint, or should publishers be able to choose it even when `index.html` exists?
2. Should the first directory view show only one directory level with drill-down, or a recursive tree for the whole **Revision**?
3. Should platform-generated listing objects appear in **Agent View**, or stay an internal renderer input?
4. Should listing entries include uploaded timestamps and hashes, or only path, size, and served content type?
5. Should the **Bundle** include the generated listing object, or only files supplied by the publisher?

## Caching

After token verification, cache by `(workspace_id, artifact_id, revision_id, path)`. Responses carry `Cache-Control: private, max-age={remaining_token_seconds}`. Stable app or Access Link URLs are never cached as if they were immutable content.
