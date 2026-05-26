# WorkOS AuthKit for Web App Auth

Status: Accepted. Supersedes [ADR 0002](./0002-auth0-for-workspace-authentication.md) for the `apps/web` surface.

The `apps/web` dashboard authenticates humans through WorkOS AuthKit using the officially maintained [`@workos/authkit-tanstack-react-start`](https://github.com/workos/authkit-tanstack-start) integration. WorkOS owns the session cookie, the PKCE state, and refresh; `apps/api` verifies WorkOS access tokens via JWKS and matches the `client_id` claim. The Auth0 path picked in ADR 0002 is retired before any login completed against it.

## Context

Phase 3 web scaffold landed but no login has ever completed. The Auth0 tenant hit the free-tier application cap on `auth0.zaks.io` before the production app could be provisioned, and the bespoke `auth.ts` / `auth-fns.ts` / `session.ts` + arctic + iron-session glue in `apps/web` had grown beyond what is worth maintaining for a single OIDC provider.

WorkOS AuthKit's free tier covers 1M MAU with no application count cap, is OIDC-compliant, and ships an officially maintained TanStack Start integration that collapses most of the bespoke session-handling code into vendor-maintained middleware. Switching before the first real login means zero migration cost: no users, no audit history, no rotation choreography.

## Decision

- `apps/web` uses `@workos/authkit-tanstack-react-start` for sign-in, callback, refresh, and sign-out. The `authkitMiddleware()` runs on every request via `createStart(() => ({ requestMiddleware: [authkitMiddleware()] }))` in `apps/web/src/start.ts`. AuthKit reads its config from `process.env`, which Cloudflare populates from the Worker's `vars` and `secret` bindings when `nodejs_compat` is enabled.
- The session cookie is renamed to `__agp_session` via `WORKOS_COOKIE_NAME` to preserve the ADR 0059 vocabulary. The host-only + `HttpOnly` + `Secure` + `SameSite=Lax` + no-`Domain` requirements from ADR 0059 still hold; AuthKit owns the iron-session sealed payload shape.
- `apps/web` forwards the WorkOS access token to `apps/api` as `Authorization: Bearer …` over the existing service binding. The `__agp_oauth_tx` transaction cookie is removed; AuthKit handles PKCE and state internally. Sign-out uses POST (`POST /api/auth/sign-out`) per WorkOS AuthKit Node.js best practices to prevent prefetch-induced session termination.
- `apps/api` verifies WorkOS access tokens via JWKS at `https://api.workos.com/sso/jwks/<client_id>` and matches the `client_id` claim. The audience-based check sketched in ADR 0059 is replaced; the rest of the resolution flow (Workspace Member upsert, RLS scope, operator allowlist) is unchanged.
- Route loaders call `getAuth()` directly from `@workos/authkit-tanstack-react-start` and compose `is_operator` at the call site from `OPERATOR_EMAILS`. No wrapper layer; WorkOS SDK types are the canonical user shape in components. The canonical route paths are `/api/auth/sign-in` (GET, 307 to WorkOS), `/api/auth/callback` (GET, `handleCallbackRoute`), and `/api/auth/sign-out` (POST, `signOut()`).
- Environment variables: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_REDIRECT_URI`, `WORKOS_COOKIE_PASSWORD` (32+ chars), `WORKOS_COOKIE_NAME=__agp_session`. `OPERATOR_EMAILS` and `WEB_BASE_URL` are unchanged. The Auth0 vars (`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_AUDIENCE`, `WEB_SESSION_SEAL_KEY_V1`) are removed; no backwards-compat shim because nothing was deployed.

## Consequences

- [ADR 0002](./0002-auth0-for-workspace-authentication.md) is superseded for `apps/web`. [ADR 0060](./0060-cli-authentication-via-auth0-loopback.md) and [ADR 0061](./0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) now complete the same provider decision for CLI login and MCP: WorkOS is the human-auth provider across all three surfaces.
- [ADR 0033](./0033-tanstack-start-for-the-web-app.md) is unchanged in stack choice. The arctic-specific guidance becomes "use the AuthKit TanStack Start integration." The lint rule that blocks session imports from Access Link routes now blocks `@workos/authkit-tanstack-react-start` and `@workos/authkit-session` in addition to the existing `../server/auth*` and `@tanstack/react-start/server` entries.
- [ADR 0055](./0055-signup-auto-provisions-personal-workspace-and-default-key.md) is unchanged in semantics. The callback flow moves into AuthKit's `handleCallbackRoute({...})`; first-login workspace provisioning still happens server-side on the first authenticated `apps/api` call.
- [ADR 0059](./0059-web-app-session-and-auth-forwarding-to-api.md) cookie name (`__agp_session`), host-only scope, and forwarding model are preserved. The sealed payload shape is now AuthKit-owned (iron-session blob) instead of bespoke; refresh and revocation are delegated to AuthKit middleware. The `apps/api` verifier section of that ADR is replaced by the JWKS + `client_id` check above.
- [ADR 0060](./0060-cli-authentication-via-auth0-loopback.md) is now decided as WorkOS loopback PKCE. [ADR 0061](./0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) is now decided as WorkOS AuthKit/Connect for MCP OAuth, with CIMD primary and DCR enabled for compatibility. Together, web, CLI login, and MCP use WorkOS as the single human-auth provider.
- [ADR 0062](./0062-two-layer-cache-for-hot-path-auth-lookups.md) caches the resolved member row after WorkOS verification; the immutable join key is `workspace_members.workos_user_id`. Cache semantics are unchanged.
- [ADR 0064](./0064-native-ratelimit-bindings-for-authenticated-counters.md) keys on the `sub` claim. WorkOS issues the same shape (`user_…`); no code change required beyond the column rename.

## What this ADR does not change

- The API-key authentication path ([ADR 0043](./0043-bearer-credential-format-and-storage.md)).
- The unauthenticated Access Link path ([ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md)). The lint guard on `apps/web/src/routes/al.*` still enforces no session imports.
- The operator allowlist model ([ADR 0046](./0046-operator-identity-and-web-admin-surface.md)). `is_operator` is still derived from `OPERATOR_EMAILS` matched against the authenticated user's verified email.
- The service binding transport from `web` to `api`.
- Workspace RLS scoping ([ADR 0044](./0044-workspace-isolation-via-postgres-rls.md)).

## Follow-Ups

- Provision the WorkOS preview and production projects, configure redirect URIs, capture `WORKOS_CLIENT_ID` per environment, and seal the cookie passwords in Bitwarden. Tracked in [`docs/ops/web-app-todo.md`](../ops/web-app-todo.md).
- Extend `scripts/bootstrap-secrets.mjs` to push `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_CLIENT_ID`, and `OPERATOR_EMAILS` to both Workers.
- Implement `POST /v1/auth/web/callback` in `apps/api` with the WorkOS JWKS verifier and Workspace Member upsert.
- Write `docs/ops/runbook-workos.md` covering project config, rotation procedure, and common failure modes.
