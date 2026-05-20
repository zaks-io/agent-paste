# Web App Session and Auth Forwarding to api

The `web` Worker on `app.agent-paste.sh` holds an authenticated user's session in an encrypted, host-only cookie and forwards the contained Auth0 access token to `api` on every request via a Cloudflare service binding. `api` verifies the token against Auth0 JWKS, resolves the **Workspace Member** by Auth0 `sub` on each request, and proceeds through the same scope and RLS pipeline ([ADR 0034](./0034-unified-scope-model-across-actors.md), [ADR 0044](./0044-workspace-isolation-via-postgres-rls.md)) as any other authenticated actor. No custom claim is minted into the token; `api` looks up workspace membership directly.

## Considered Options

- **Custom claim with `workspace_member_id` minted by an Auth0 Post-Login Action.** Saves one indexed `SELECT` per request and makes the token self-contained. The cost is real: a Post-Login Action that either calls out to `api` or reads `user.app_metadata`, a Management API write after the auto-provision transaction from [ADR 0055](./0055-signup-auto-provisions-personal-workspace-and-default-key.md) to set `app_metadata.workspace_member_id`, and a fallback for first-sign-in tokens that are minted *before* the metadata exists. Three moving parts to avoid one composite-indexed query that the RLS setup already implies. Rejected.
- **Opaque session ID with server-side session storage (KV or DO).** Cookie holds a random ID; `web` reads the full session from KV per request. Cleaner revocation semantics. Trade-off is an extra KV read on every dashboard navigation and an additional store to operate. Not worth it for a single-region MVP whose session payload is small enough to seal into a cookie.
- **Forward only the Auth0 ID token, drop the access token from the session.** Smaller cookie. Loses the ability to call Auth0's userinfo endpoint or refresh on behalf of the user without a new login. Rejected because the refresh path matters for keeping sessions alive through the workday.
- **Mint an internal web-signed bearer instead of forwarding the Auth0 access token.** `web` signs a short-lived JWT with its own HMAC key; `api` verifies with the same key. Adds a third signing key to bootstrap, rotate, and reason about, when the Auth0 access token is already a verifiable bearer. Rejected.
- **Encrypted-blob cookie sealed by `web`, Auth0 access token forwarded as `Authorization: Bearer` over service binding, `api` resolves `Workspace Member` by `sub` on each request (chosen).** Smallest surface area, no new signing key, no Auth0 Management API dependency, no chicken-and-egg with auto-provisioning.

## Consequences

### Session cookie

- **Name:** `__agp_session`. Issued by `web` after the `/auth/callback` exchange completes per [ADR 0055](./0055-signup-auto-provisions-personal-workspace-and-default-key.md).
- **Payload (sealed):** `{ access_token, refresh_token, expires_at, sub }`. Sealed using AES-GCM with the `WEB_SESSION_SEAL_KEY_V1` Worker secret added to the bootstrap script in [ADR 0058](./0058-first-deploy-schema-and-secret-bootstrap.md). Key rotation follows the same staged-overlap pattern from [ADR 0045](./0045-secret-rotation-cadence-and-on-demand-tooling.md): a verifying `V2` is added before `V1` is dropped so in-flight sessions survive the cut.
- **Attributes:** `HttpOnly; Secure; SameSite=Lax; Path=/`. No `Domain` attribute, making it host-only per [ADR 0014](./0014-single-domain-with-hardened-content-subdomain.md); the cookie is never sent to `api.agent-paste.sh`, `usercontent.agent-paste.sh`, or the marketing apex.
- **`SameSite=Lax`, not `Strict`,** because Auth0's redirect back to `/auth/callback` must carry the cookie set by `/login`. Strict drops it on cross-site navigation.
- **Lifetime:** matches Auth0 refresh-token lifetime. The cookie is cleared on `/logout` and on any refresh failure.
- **`/al/*` does not read or write this cookie.** The Access Link viewer is fully unauthenticated and the route group does not import the session module, enforced by the lint rule from [ADR 0033](./0033-tanstack-start-for-the-web-app.md).

### Forwarding to `api`

- **Transport:** Cloudflare service binding from `web` to `api`. No public network hop, no TLS handshake on the internal call. The receiving Worker sees a normal `Request` with the headers `web` set.
- **Auth header:** `Authorization: Bearer <auth0_access_token>`. `api`'s auth middleware accepts this format alongside the `ap_pk_…` bearer format from [ADR 0043](./0043-bearer-credential-format-and-storage.md). The bearer's prefix or its parseability as a JWT discriminates the path.
- **Audience:** Auth0 access tokens are minted with `audience=https://api.agent-paste.sh/v1`. `api` rejects tokens with any other audience.
- **JWKS verification:** `api` verifies token signature against Auth0's JWKS, cached in a Worker Cache binding with a short TTL. JWKS fetch failures fall back to in-memory cache; expired JWKS cache plus a fetch failure returns `unauthenticated`, not a verify-bypass.

### Resolving Workspace Member on each request

- `api`'s auth middleware extracts `sub` from the verified JWT and runs `SELECT workspace_member_id, workspace_id, scopes FROM workspace_members WHERE auth0_sub = $1` under `platform_admin` (this is the only path that legitimately needs to find a workspace before knowing which workspace to scope to). The query is bounded to that one row and that column set; it does not pull tenant data.
- The result is attached to the request context. Subsequent middleware (scope check from [ADR 0034](./0034-unified-scope-model-across-actors.md), RLS setup from [ADR 0044](./0044-workspace-isolation-via-postgres-rls.md), audit recording from [ADR 0004](./0004-audit-state-changes-through-wrapper.md)) reads from the context rather than re-querying.
- Auth0 `sub` is the immutable join key per ADR 0055. Email or display-name changes upstream do not detach the **Workspace Member** row.
- Workspace Member rows have a composite index on `(auth0_sub)`; lookup is sub-millisecond and adds no measurable cost.

### Refresh

- `web` checks `expires_at` on the decrypted session at the start of each server function or loader. When the access token is within 60 seconds of expiry, `web` performs an Auth0 refresh-token grant, re-seals the cookie with the new `{access_token, refresh_token, expires_at}`, and proceeds.
- Refresh tokens never leave the sealed blob and are never logged.
- A refresh failure (Auth0 returns `invalid_grant` or any 4xx) clears the cookie and returns a 302 to `/login`. Network-level failures retry once, then fall through to a 302.

### Logout

- `/logout` clears `__agp_session` with `Max-Age=0` and redirects to Auth0's logout endpoint with `returnTo=https://app.agent-paste.sh/login`. Auth0 clears its own session and bounces back.
- There is no server-side session store, so logout is purely cookie-clear plus the Auth0 hop. Tokens issued before logout remain technically valid for their remaining lifetime; the platform accepts this because access-token TTL is short and refresh tokens cannot survive a missing cookie.

### What this ADR does not change

- The `ap_pk_` API Key path through `api`'s auth middleware ([ADR 0043](./0043-bearer-credential-format-and-storage.md)) is untouched.
- The unauthenticated Access Link resolve path from [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md) remains POST-with-fragment, no Authorization header, no cookie.
- The operator surface gating from [ADR 0046](./0046-operator-identity-and-web-admin-surface.md) runs *after* this middleware resolves the **Workspace Member**; it checks whether the resolved email is in `OPERATOR_EMAILS`.

### Why not put any of this in CONTEXT.md

This is a transport and auth-middleware decision, not domain language. The **Workspace Member**, **API Key**, and **Auth0** terms already exist in the glossary; how `web` forwards a token to `api` is enforcement detail.
