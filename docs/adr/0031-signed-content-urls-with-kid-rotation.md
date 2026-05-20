# Signed Content URLs from `api` to `content` with `kid` Rotation

Authenticated private reads of **Untrusted Content** are served through short-lived HMAC-signed URLs that `api` mints and `content` validates. URLs carry a key id (`kid`) so the shared HMAC secret can be rotated with an overlap window during which both the previous and current `kid` are accepted. `content` validates the signature without trusting `api`'s session and consults Postgres for revision deletion or retention state before serving bytes. This keeps the **Content Origin** isolation that ADR 0014 establishes intact while giving authenticated private reads a workable read path that does not rely on cross-origin cookies or long-lived bearer tokens.

## Consequences

- URL format: `https://content.agent-paste.sh/v1/private/<artifact_id>/<revision_id>/<path>?exp=<unix_seconds>&kid=<key_id>&sig=<base64url>` where `sig = HMAC_SHA256(secret[kid], '<artifact_id>:<revision_id>:<path>:<exp>')`.
- `exp` is 120 seconds by default; routes may extend up to 300 seconds for large-file workflows. Stable long-lived URLs are out of scope: re-fetching the **Agent View** re-mints them.
- The shared HMAC secret is stored as a Worker secret in `api` (sign) and `content` (verify). Rotation creates a new `kid` and stages it in `content` first; `api` switches to signing with the new `kid` once `content` has the new secret. The previous `kid` is accepted by `content` for 24 hours after rotation so URLs minted just before the switch remain valid.
- `content` validates: parse the URL, confirm `kid` is current or within the overlap window, check `exp > now()`, recompute the HMAC, constant-time compare. Any failure returns the generic `not_found` per ADR 0030.
- `content` checks `revisions.status` and the parent `artifacts` row in Postgres before serving bytes so deleted artifacts and retained revisions stop serving immediately, ahead of the signed URL's natural expiry.
- This path is for authenticated private reads only. Access-link bearer reads continue to carry the access-link token directly per the **Agent View** envelope decision; the access-link token is the canonical bearer credential for the unauthenticated path and revocation through the token propagates without a separate signing key.
- `api` mints these URLs at **Agent View** response time. The URL `path` segment is the file path inside the resolved **Revision**, sanitized for URL safety; `api` never embeds the R2 object key directly because the R2 key layout (ADR 0021) is an internal storage detail.
- Programmatic consumers that cache **Agent View** responses must handle URL expiry by re-fetching. The CLI handles this transparently.
