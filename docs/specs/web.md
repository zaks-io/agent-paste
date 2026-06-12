# Web Surface Spec

This is the current web surface spec for the dashboard, Artifact Viewer opened by Access Links,
claim flow, billing page, and operator UI. The CLI-first MVP had no dashboard,
but the hosted service now ships these routes.

The `web` Worker uses TanStack Start and serves `app.agent-paste.sh`. It owns no Postgres, R2, KV, or queue bindings. All durable reads and writes go through `api`.

## Route Groups

| Route                     | Auth             | Purpose                                                                                             |
| ------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `/`                       | optional         | Redirect to `/dashboard` when signed in, `/api/auth/sign-in` when not.                              |
| `/api/auth/sign-in`       | none             | Start WorkOS AuthKit Authorization Code + PKCE login.                                               |
| `/api/auth/sign-out`      | session          | Clear the AuthKit session through POST-only sign-out.                                               |
| `/api/auth/callback`      | none             | Complete WorkOS AuthKit Authorization Code + PKCE flow and establish the session.                   |
| `/al/{publicId}`          | none             | Artifact Viewer opened by an Access Link. Reads fragment and calls `POST /v1/access-links/resolve`. |
| `/dashboard`              | dashboard member | Workspace overview.                                                                                 |
| `/artifacts`              | dashboard member | Artifact list.                                                                                      |
| `/artifacts/{artifactId}` | dashboard member | Authenticated Artifact detail and management: revisions, links, warnings, bundle state.             |
| `/keys`                   | dashboard member | API Key list and creation flow.                                                                     |
| `/audit`                  | dashboard member | Audit Event list.                                                                                   |
| `/settings`               | dashboard member | Workspace name and Auto Deletion setting.                                                           |
| `/admin`                  | operator         | Operator-only dashboard.                                                                            |

`/al/*` must not import WorkOS/AuthKit session modules. A lint rule should enforce this.

## First-Run Key State

## Auth Callback Flow

The browser-facing login flow follows WorkOS AuthKit Authorization Code Flow with PKCE.

`/api/auth/sign-in`:

- Calls the AuthKit integration to create the WorkOS authorization URL.
- Redirects to WorkOS with the configured `WORKOS_REDIRECT_URI`.
- Leaves AuthKit in charge of state, PKCE, refresh, and transaction/session cookies.

`/api/auth/callback`:

- Rejects OAuth error responses, missing code, missing transaction cookie, and mismatched `state`.
- Exchanges the code through AuthKit and validates the resulting session.
- Calls `POST /v1/auth/web/callback` on `api` over the `web -> api` Service Binding with the WorkOS access token as `Authorization`.
- Stores the AuthKit-owned sealed session in `__agp_session`.

No token, authorization code, PKCE verifier, state, or one-time API Key secret may be logged.

On every authed request, `api` verifies the forwarded WorkOS access token and resolves the caller's identity. The dashboard client's WorkOS JWT Template emits a `zaks-io:email` claim, so `api` reads the email straight from the verified token (the `sub` is the authoritative user id) and does **not** call the WorkOS user API. CLI and MCP tokens have no such template and fall back to `GET /user_management/users/{id}`. Member `scopes` (in-workspace authorization) always come from the database, never the token; operator status comes from the WorkOS `role` claim. See [ADR 0082](../adr/0082-identity-in-token-authorization-in-db.md). The residual ~1–2.7s sometimes seen on low-traffic authed routes is cold isolate + cold Hyperdrive connection warmup (it disappears under continuous traffic), not the auth path.

Read-only Workspace Members can list Access Links workspace-wide and per
Artifact. Access Link management mutations - create, mint, revoke, Access Link
Lockdown set, and Access Link Lockdown lift - require the current API-side
representation of the share capability: the member `admin` scope resolved from
the database, not WorkOS token text.

After first provisioning, `POST /v1/auth/web/callback` receives the default API Key plaintext once. The dashboard stores it only in client memory for the first-run card. The secret is never persisted, never written to logs, and never retrievable from `api`.

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
- Published Revision summary and management preview iframe.
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
- Scope selection is not exposed in the MVP. Dashboard-created keys use the API-key scope vocabulary and are minted with `publish` and `read`, matching first-run and CLI-minted keys.
- The MCP OAuth consent vocabulary (`write`, `read`, `share`) is not shown on `/keys`; it applies only to MCP-issued tokens.
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
- Auto Deletion days, min 1. The settings response includes the effective max
  for the current **Workspace**: Free and billing-off launch workspaces cap at
  7 days; Pro workspaces with billing enabled cap at 90 days. The static route
  contract accepts the platform syntactic ceiling of 90 and repository policy
  enforces the effective per-workspace bound.
- Read-only Usage Policy caps.

## Artifact Viewer

The `/al/{publicId}` page:

- Loads no analytics, external fonts, external images, or third-party scripts.
- Sets `Referrer-Policy: no-referrer`.
- Uses route-specific CSP from ADR 0047.
- Reads `window.location.hash`, strips `#`, and posts `{ public_id, blob }` to `api`.
- Shows generic not-found for all resolve failures, including active Platform
  Lockdown and Access Link Lockdown.
- Renders the resolved Artifact through the content origin iframe or direct media element depending on Render Mode.
- Uses a bottom-left floating `agent-paste.sh` wordmark control instead of a
  full-width header. The control and metadata panel have solid theme-background
  fills, use the vermilion brand accent only in the wordmark hyphen, open
  Artifact metadata (title, Render Mode, and public Access Link id), and offer a
  non-persistent hide action; a reload shows the control again.
- Is the recipient-facing live page opened by an **Access Link Signed URL** minted from a **Share Link**. Do not direct recipients to `/artifacts/{artifactId}` for live viewing.

## Operator UI

Operator routes are visible only when the active WorkOS session carries the
`admin` role slug.

MVP operator actions:

- Apply Artifact Platform Lockdown.
- Apply Workspace Platform Lockdown.
- Lift Platform Lockdown.
- Browse cross-workspace audit and operation events with filters (`focus`, workspace, actor type, action, target type, request id).
- Follow the abuse triage guide on `/admin` (suggested reason codes, security-event filters, and lockdown prefill from event rows).

API Keys are rejected on operator routes before scope checks.
