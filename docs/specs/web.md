# Web Surface Spec

This is a future-phase spec. The CLI-first MVP has no dashboard, no admin UI, and no Access Link viewer. Keep this file for Phase 3+ self-serve login and Phase 6 dashboard work.

The `web` Worker uses TanStack Start and serves `app.agent-paste.sh`. It owns no Postgres, R2, KV, or queue bindings. All durable reads and writes go through `api`.

## Route Groups

| Route                     | Auth             | Purpose                                                                                                              |
| ------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/`                       | optional         | Redirect to `/dashboard` when signed in, `/login` when not.                                                          |
| `/login`                  | none             | Start Auth0 Authorization Code + PKCE login.                                                                         |
| `/logout`                 | session          | Clear sealed cookie and redirect through Auth0 logout.                                                               |
| `/auth/callback`          | none             | Complete Auth0 Authorization Code + PKCE flow, create sealed session, surface one-time default API Key when present. |
| `/al/{publicId}`          | none             | Minimal Access Link viewer. Reads fragment and calls `POST /v1/access-links/resolve`.                                |
| `/dashboard`              | dashboard member | Workspace overview.                                                                                                  |
| `/artifacts`              | dashboard member | Artifact list.                                                                                                       |
| `/artifacts/{artifactId}` | dashboard member | Artifact detail, revisions, links, warnings, bundle state.                                                           |
| `/keys`                   | dashboard member | API Key list and creation flow.                                                                                      |
| `/audit`                  | dashboard member | Audit Event list.                                                                                                    |
| `/settings`               | dashboard member | Workspace name and Auto Deletion setting.                                                                            |
| `/admin`                  | operator         | Operator-only dashboard.                                                                                             |

`/al/*` must not import Auth0/session modules. A lint rule should enforce this.

## First-Run Key State

## Auth Callback Flow

The browser-facing login flow follows Auth0 Authorization Code Flow with PKCE.

`/login`:

- Generates `state`, `nonce`, and a high-entropy PKCE `code_verifier`.
- Stores them in a short-lived encrypted transaction cookie that is host-only, `HttpOnly`, `Secure`, and `SameSite=Lax`.
- Redirects to Auth0 with `response_type=code`, exact `redirect_uri`, `scope=openid profile email offline_access`, API audience, `state`, `nonce`, and `code_challenge_method=S256`.

`/auth/callback`:

- Rejects OAuth error responses, missing code, missing transaction cookie, and mismatched `state`.
- Exchanges the code server-side with Auth0 using the stored `code_verifier`.
- Validates the token set, including issuer, audience, expiration, ID-token nonce, and `email_verified`.
- Calls `POST /v1/auth/web/callback` on `api` over the `web -> api` Service Binding with the Auth0 access token as `Authorization` and `{ id_token, nonce }` as the body.
- Clears the transaction cookie after success or failure.
- Seals `{ access_token, refresh_token, expires_at, sub }` into the `__agp_session` cookie only after `api` confirms or provisions the **Workspace Member**.

No token, authorization code, PKCE verifier, nonce, state, or one-time API Key secret may be logged.

After first sign-in, `/auth/callback` receives the default API Key plaintext once. The dashboard stores it only in client memory for the first-run card. The secret is never persisted, never written to logs, and never retrievable from `api`.

The first-run card includes:

- Key name.
- API Key secret in a mono field with copy button.
- Dismiss button.
- Warning that lost keys must be replaced, not recovered.

## Dashboard Pages

### `/dashboard`

- Workspace name.
- Usage policy summary.
- Recent Artifacts.
- Recent Audit Events.
- Default API Key callout only when first-run state exists.

### `/artifacts`

Columns:

- Title.
- Artifact id.
- Status.
- Latest Revision.
- Bundle Availability.
- Access Link Lockdown.
- Pinned.
- Last Published.
- Auto Delete At.
- Actions menu.

Empty state offers CLI publish command and API Key link.

### `/artifacts/{artifactId}`

Sections:

- Header with title, id, status, pinned state, lockdown state.
- Display Metadata edit form.
- Published Revision summary and viewer iframe.
- Revision table.
- Access Link table with create, mint/copy, revoke.
- Bundle Availability and download action.
- Safety Warnings.
- Destructive Delete action.

Viewer iframe uses `sandbox="allow-scripts allow-popups"` and never `allow-same-origin`.

### `/keys`

List columns:

- Name.
- Public id.
- Scopes.
- Expiration.
- Last Used.
- Created.
- Revoked state.

Create form:

- Name.
- Scope checkboxes limited to `write`, `read`, `share`.
- Optional expiration.
- One-time secret result card.

### `/audit`

Columns:

- Time.
- Actor.
- Action.
- Target.
- Change Summary.
- Request id.

### `/settings`

Fields:

- Workspace name.
- Auto Deletion days, min 1 and max 90.
- Read-only Usage Policy caps.

## Access Link Viewer

The `/al/{publicId}` page:

- Loads no analytics, external fonts, external images, or third-party scripts.
- Sets `Referrer-Policy: no-referrer`.
- Uses route-specific CSP from ADR 0047.
- Reads `window.location.hash`, strips `#`, and posts `{ public_id, blob }` to `api`.
- Shows generic not-found for all resolve failures.
- Renders the resolved Artifact through the content origin iframe or direct media element depending on Render Mode.

## Operator UI

Operator routes are visible only when the authenticated email is in `OPERATOR_EMAILS`.

MVP operator actions:

- Apply Artifact Platform Lockdown.
- Apply Workspace Platform Lockdown.
- Lift Platform Lockdown.
- View recent lockdown Audit Events.

API Keys are rejected on operator routes before scope checks.
