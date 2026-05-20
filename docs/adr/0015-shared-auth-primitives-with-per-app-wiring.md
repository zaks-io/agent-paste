# Shared Auth Primitives with Per-App Wiring

Authentication and authorization primitives will live in `packages/auth`, but each app must explicitly wire only the auth modes it is allowed to accept. This keeps Auth0 JWT verification, API key hashing, API key verification, and scope checks reusable without making ambient authentication available everywhere.

## Consequences

- `api` can accept Auth0 user auth and scoped API keys.
- `upload` can accept scoped API keys and may later accept Auth0 for dashboard-driven uploads.
- `content` should not trust ambient app cookies and should resolve access through access links, private access checks, or explicit headers.
- Shared auth helpers must not hide which actor type a request used.
- API key secrets should be shown only at creation time, stored non-recoverably, and never returned by later reads.
- Access link tokens should be treated as bearer secrets and excluded from logs and audit summaries. _(Superseded by [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md): Access Links are now signed URLs with the signature in the URL fragment; there is no stored bearer token.)_
- Access link tokens may be stored recoverably with encryption at rest so authorized workspace members and API keys with read and share scopes can retrieve existing links later. _(Superseded by [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md): the `access_links` row holds no secret; "recovery" is re-minting the signed URL on demand.)_
- Public Access Link failures should use generic not-found responses so callers cannot distinguish invalid, revoked, expired, deleted, locked down, or retention-removed links.
- Authenticated management surfaces may show the specific reason an Access Link no longer resolves.
- Authenticated private and management requests may return specific deleted, retained, unpublished, expired, or locked-down states after workspace authorization succeeds.
