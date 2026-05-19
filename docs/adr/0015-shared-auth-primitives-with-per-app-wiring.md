# Shared Auth Primitives with Per-App Wiring

Authentication and authorization primitives will live in `packages/auth`, but each app must explicitly wire only the auth modes it is allowed to accept. This keeps Auth0 JWT verification, API key hashing, API key verification, and scope checks reusable without making ambient authentication available everywhere.

## Consequences

- `api` can accept Auth0 user auth and scoped API keys.
- `upload` can accept scoped API keys and may later accept Auth0 for dashboard-driven uploads.
- `content` should not trust ambient app cookies and should resolve access through share links, private access checks, or explicit headers.
- Shared auth helpers must not hide which actor type a request used.
