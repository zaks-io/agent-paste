# Signed Content Gateway Tokens for Content Origin Authorization

Status: Accepted. Supersedes [ADR 0031](./0031-signed-content-urls-with-kid-rotation.md) for all `api`-to-`content` read URLs.

The `content` worker authorizes every external request by verifying a short-lived signed token carried in the URL path prefix, not by reading the database. `api` mints these tokens after resolving an authenticated **Private Link** or an unauthenticated **Access Link Signed URL** from [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md). The token is one opaque base64url path segment that decodes to `(workspaceId, artifactId, revisionId, accessLinkId?, exp, scopes, kid, sig)` where `sig = HMAC(secret[kid], canonical_payload)`. The token grants bounded read access to one resolved **Revision**; row-level link state is checked by `api` before minting, and mid-token invalidation is enforced through a short-TTL Workers KV denylist keyed by `artifactId`, `revisionId`, and `accessLinkId` when present.

## Considered Options

- Database lookup per request: strongest correctness, but every external content request becomes a Hyperdrive read and the worker can no longer cache by **Revision** identity (ADR 0020) without folding access state into the cache key.
- Signed cookies on the content origin: cleaner subresource resolution, but adds a cookie surface on the untrusted content origin in tension with ADR 0014 and surfaces third-party cookie quirks.
- Per-mint asymmetric (Ed25519) signatures: verifier cannot mint, but larger signatures bloat the URL token.
- Service binding to `api` for per-request authorization: removes the shared secret, but couples `content` latency to `api` and reverses the no-DB-on-hot-path design.

## Consequences

- Token shape: `usercontent.agent-paste.sh/v/{token}/{path}` for files and `/b/{token}` for **Bundles**. The signed segment is part of the path, so HTML subresources with relative URLs (`./logo.png`) inherit the same prefix without rewriting bytes.
- The token never carries plain `workspaceId`, `artifactId`, or `revisionId` as readable URL segments; tenant boundaries are not visible in shared URLs.
- Token `exp` is short (15 minutes by default). Minters re-mint when a viewer reloads or follows a **Revision Link** / **Share Link**.
- Key rotation is via versioned `kid`: `content` holds `{kid → secret}` with current and previous; minters sign only with current `kid`. Rotation is add-new, flip-minters, drain-old, drop-old.
- The KV denylist is written by `api` (for **Access Link** revocation, **Access Link Lockdown**, and **Platform Lockdown** changes) and `jobs` (for **Deletion** and **Retention** removals). Entry TTL is the longest minted-token TTL.
- `api` checks **Artifact**, **Revision**, **Access Link**, **Access Link Lockdown**, **Platform Lockdown**, and **Usage Policy** state before minting a token. `content` only verifies token cryptography, expiration, scope, and denylist state.
- Public failure semantics are deliberately generic: missing, malformed, expired, denylisted, wrong-scope, and missing-path requests all return the `not_found` envelope from [ADR 0036](./0036-error-envelope-and-generic-404-boundary.md). The operational log records the internal reason with the resolved identifiers where available.
- `content` has an R2 read binding, a Workers KV read binding for the denylist, and no Hyperdrive binding.
- Edge caching uses a synthetic cache key over `(workspaceId, artifactId, revisionId, path)` after authorization (ADR 0020). Responses carry `Cache-Control: private, max-age={remaining_exp}`. **Note ([ADR 0081](./0081-etag-validators-and-conditional-304s-for-content.md)):** this edge cache is not wired today. The realized caching is client-side validators — a strong `ETag` over `(revision_id, path)` and `If-None-Match` → `304` — and a uniform `private, no-cache` `Cache-Control` on every served file and the bundle (errors `no-store`), so each load revalidates rather than serving from a warm `max-age` cache that could hand back a revoked or expired artifact.
- A leaked URL is bounded by `exp` and revocable mid-window through the denylist; recovering from a leaked **Access Link** does not require deleting the **Artifact** or rotating R2 keys.
- Direct R2 read URLs remain never-exposed (ADR 0001); `content` never returns them or 302s to them.
