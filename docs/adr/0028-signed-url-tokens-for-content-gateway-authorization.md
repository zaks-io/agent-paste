# Signed-URL Tokens for Content Gateway Authorization

The `content` worker authorizes every external request by verifying a signed token carried in the URL path prefix, not by reading the database. `api` and `web` mint tokens after resolving a **Private Link**, **Share Link**, or **Revision Link**. The token is one opaque base64url path segment that decodes to `(workspaceId, artifactId, revisionId, accessLinkId, exp, kid, sig)` where `sig = HMAC(secret[kid], "{workspaceId}|{artifactId}|{revisionId}|{accessLinkId}|{exp}")`. Mid-token revocation is enforced through a short-TTL Workers KV denylist keyed by `artifactId` and `accessLinkId`.

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
- The KV denylist is written by `api` (for **Access Link** revocation and **Access Link Lockdown** changes) and `jobs` (for **Deletion** and **Retention** removals). Entry TTL is the longest minted-token TTL.
- Error semantics: `401` for missing, malformed, or expired signature (re-mintable); `410 Gone` for denylist hits (revoked **Access Link**, active **Access Link Lockdown**, deleted **Artifact**, retention-removed **Revision**); `404` for paths missing inside an otherwise valid **Revision**.
- `content` has an R2 read binding, a Workers KV read binding for the denylist, and no Hyperdrive binding.
- Edge caching uses a synthetic cache key over `(workspaceId, artifactId, revisionId, path)` after authorization (ADR 0020). Responses carry `Cache-Control: private, max-age={remaining_exp}`.
- A leaked URL is bounded by `exp` and revocable mid-window through the denylist; recovering from a leaked **Access Link** does not require deleting the **Artifact** or rotating R2 keys.
- Direct R2 read URLs remain never-exposed (ADR 0001); `content` never returns them or 302s to them.
