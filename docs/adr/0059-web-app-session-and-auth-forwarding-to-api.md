# Web App Session and Auth Forwarding to api

Status: Accepted. Refined by [ADR 0068](./0068-workos-authkit-for-web-app-auth.md): WorkOS AuthKit owns the session cookie, PKCE state, token exchange, refresh, and sign-out routes.

The `web` Worker on `app.agent-paste.sh` holds an authenticated user's WorkOS AuthKit session in an encrypted, host-only cookie and forwards the WorkOS access token to `api` on every request via a Cloudflare service binding. Login uses WorkOS AuthKit's Authorization Code Flow with PKCE through `@workos/authkit-tanstack-react-start`; `api` owns provisioning through `POST /v1/auth/web/callback` after independently verifying the WorkOS token material. For normal authenticated requests, `api` verifies the access token against WorkOS JWKS, resolves the **Workspace Member** by `workspace_members.workos_user_id`, and proceeds through the same scope and RLS pipeline ([ADR 0034](./0034-unified-scope-model-across-actors.md), [ADR 0044](./0044-workspace-isolation-via-postgres-rls.md)) as any other authenticated actor. No custom claim is minted into the token; `api` looks up workspace membership directly.

## Considered Options

- **Custom claim with `workspace_member_id` minted by provider-side login actions.** Saves one indexed `SELECT` per request and makes the token self-contained. The cost is real: provider-side actions, a Management API write after the auto-provision transaction from [ADR 0055](./0055-signup-auto-provisions-personal-workspace-and-default-key.md) to set metadata, and a fallback for first-sign-in tokens that are minted _before_ the metadata exists. Three moving parts to avoid one indexed query that the RLS setup already implies. Rejected.
- **Opaque session ID with server-side session storage (KV or DO).** Cookie holds a random ID; `web` reads the full session from KV per request. Cleaner revocation semantics. Trade-off is an extra KV read on every dashboard navigation and an additional store to operate. Not worth it for a single-region MVP whose session payload is small enough to seal into a cookie.
- **Forward only the WorkOS ID token, drop the access token from the session.** Smaller cookie. Loses the normal access-token verification path and refresh behavior. Rejected because the refresh path matters for keeping sessions alive through the workday.
- **Mint an internal web-signed bearer instead of forwarding the WorkOS access token.** `web` signs a short-lived JWT with its own HMAC key; `api` verifies with the same key. Adds a signing key to bootstrap, rotate, and reason about, when the WorkOS access token is already a verifiable bearer. Rejected.
- **WorkOS AuthKit cookie, WorkOS access token forwarded as `Authorization: Bearer` over service binding, `api` resolves `Workspace Member` by `workos_user_id` on each request (chosen).** Smallest surface area, no app-owned session signing key, no WorkOS metadata write dependency, no chicken-and-egg with auto-provisioning.

## Consequences

### Session cookie

- **Name:** `__agp_session`. Issued by WorkOS AuthKit after the `/api/auth/callback` exchange completes per [ADR 0068](./0068-workos-authkit-for-web-app-auth.md).
- **Payload (sealed):** AuthKit-owned iron-session payload. It is sealed with `WORKOS_COOKIE_PASSWORD` rather than an app-defined `WEB_SESSION_SEAL_KEY_V1`.
- **Attributes:** `HttpOnly; Secure; SameSite=Lax; Path=/`. No `Domain` attribute, making it host-only per [ADR 0014](./0014-single-domain-with-hardened-content-subdomain.md); the cookie is never sent to `api.agent-paste.sh`, `usercontent.agent-paste.sh`, or the marketing apex.
- **`SameSite=Lax`, not `Strict`,** because WorkOS's redirect back to `/api/auth/callback` must carry the AuthKit transaction/session cookie. Strict drops it on cross-site navigation.
- **Lifetime:** follows WorkOS AuthKit session and refresh configuration. The cookie is cleared on sign-out and on any refresh failure.
- **`/al/*` does not read or write this cookie.** The Access Link viewer is fully unauthenticated and the route group does not import the session module, enforced by the lint rule from [ADR 0033](./0033-tanstack-start-for-the-web-app.md).

### Forwarding to `api`

- **Transport:** Cloudflare service binding from `web` to `api`. No public network hop, no TLS handshake on the internal call. The receiving Worker sees a normal `Request` with the headers `web` set.
- **Auth header:** `Authorization: Bearer <workos_access_token>`. `api`'s auth middleware accepts this format alongside the `ap_pk_...` bearer format from [ADR 0043](./0043-bearer-credential-format-and-storage.md). The bearer's prefix or its parseability as a JWT discriminates the path.
- **Audience/client check:** Dashboard AuthKit session tokens are verified with the WorkOS issuer/JWKS configured for the environment. Where WorkOS supplies a client claim, `api` matches the configured dashboard client; for User Management session tokens that lack a client claim, `api` pins issuer + JWKS + environment configuration per the WorkOS runbook.
- **JWKS verification:** `api` verifies token signature against WorkOS JWKS, cached with a short TTL. JWKS fetch failures fall back to in-memory cache; expired JWKS cache plus a fetch failure returns `unauthenticated`, not a verify-bypass.

### Resolving Workspace Member on each request

- `api`'s auth middleware extracts the WorkOS user id from the verified JWT/resolved WorkOS identity and runs `SELECT workspace_member_id, workspace_id, scopes FROM workspace_members WHERE workos_user_id = $1` under `platform_admin` (this is the only path that legitimately needs to find a workspace before knowing which workspace to scope to). The query is bounded to that one row and that column set; it does not pull tenant data.
- The result is attached to the request context. Subsequent middleware (scope check from [ADR 0034](./0034-unified-scope-model-across-actors.md), RLS setup from [ADR 0044](./0044-workspace-isolation-via-postgres-rls.md), audit recording from [ADR 0004](./0004-audit-state-changes-through-wrapper.md)) reads from the context rather than re-querying.
- `workos_user_id` is the immutable join key per ADR 0055. Email or display-name changes upstream do not detach the **Workspace Member** row.
- Workspace Member rows have a unique index on `(workos_user_id)`; lookup is sub-millisecond and adds no measurable cost.

### Refresh

- AuthKit middleware checks and refreshes the session at the start of each request/server function according to WorkOS configuration, then makes the current access token available to route loaders and server functions.
- Refresh tokens never leave the sealed blob and are never logged.
- A refresh failure clears the cookie and returns the user to sign-in. Network-level failures retry once, then fall through to sign-in.

### Logout

- `POST /api/auth/sign-out` calls AuthKit `signOut()`, clears `__agp_session`, and ends the WorkOS session flow. The app does not expose GET logout so prefetchers cannot terminate a session.
- There is no app-owned server-side session store, so logout is cookie-clear plus the WorkOS/AuthKit hop. Tokens issued before logout remain technically valid for their remaining lifetime; the platform accepts this because access-token TTL is short and refresh tokens cannot survive a missing cookie.

### What this ADR does not change

- The `ap_pk_` API Key path through `api`'s auth middleware ([ADR 0043](./0043-bearer-credential-format-and-storage.md)) is untouched.
- The unauthenticated Access Link resolve path from [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md) remains POST-with-fragment, no Authorization header, no cookie.
- The operator surface gating from [ADR 0046](./0046-operator-identity-and-web-admin-surface.md) runs _after_ this middleware resolves the **Workspace Member**; it checks whether the active WorkOS session carries the `admin` role slug.

### Why not put any of this in CONTEXT.md

This is a transport and auth-middleware decision, not domain language. The **Workspace Member** and **API Key** terms already exist in the glossary; how `web` forwards a WorkOS token to `api` is enforcement detail.
