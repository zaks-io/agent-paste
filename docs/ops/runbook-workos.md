# WorkOS Auth Runbook

Operator runbook for WorkOS AuthKit (web dashboard), User Management session verification in `api`, and the CLI Connect app. Covers project configuration, redirect URI drift, credential rotation, and common auth failures.

Scope:

- Preview and production WorkOS environments (one environment per deploy target).
- `apps/web` AuthKit sign-in/callback/sign-out.
- `apps/api` WorkOS token verification for dashboard (`/v1/web/*`), web callback (`POST /v1/auth/web/callback`), and CLI login.
- Per-PR preview web deploy when `WORKOS_PREVIEW_API_KEY` is set.

Out of scope:

- MCP host onboarding and smoke — see [`runbook-mcp-hosts.md`](./runbook-mcp-hosts.md).
- Auth0 paths (retired before first login; see ADR 0068).

Related docs:

- [ADR 0068](../adr/0068-workos-authkit-for-web-app-auth.md) — AuthKit integration decisions.
- [ADR 0059](../adr/0059-web-app-session-and-auth-forwarding-to-api.md) — WorkOS session cookie and forwarding model.
- [ADR 0060](../adr/0060-cli-authentication-via-auth0-loopback.md) — CLI loopback Connect app (WorkOS implementation).
- [Web app todo](./web-app-todo.md) — Phase 3 web close-out history and env identifiers.
- [Rotation runbook](./runbook-rotation.md) — step-by-step WorkOS secret rotation (`WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`).
- [Hosted ops](./status/hosted-ops.md) — deploy order and secrets inventory summary.

## WorkOS project and environment layout

WorkOS is **per deploy target**, not one project backing both preview and production.

| Deploy target | WorkOS environment | AuthKit subdomain                             | Dashboard AuthKit `client_id` (`WORKOS_CLIENT_ID`) |
| ------------- | ------------------ | --------------------------------------------- | -------------------------------------------------- |
| Preview       | Staging            | `courageous-milestone-75-staging.authkit.app` | `client_01KSAJTF1EX1YZCCXJS9B0GJ46`                |
| Production    | Production         | `soulful-path-50.authkit.app`                 | `client_01KSED0F1X2MZ0WCKNNQR6FY2X`                |

Each environment has:

- **One dashboard AuthKit app** — browser sign-in for `app.{preview.}agent-paste.sh`. Public `WORKOS_CLIENT_ID` lives in `apps/api/wrangler.jsonc` and `apps/web/wrangler.jsonc` vars; the matching `WORKOS_API_KEY` is a Worker secret on `api` and `web`.
- **One environment default OIDC client** (`WORKOS_CLI_AUDIENCE`) — stamps `aud` on User Management session tokens and CLI Connect tokens. Differs from `WORKOS_CLIENT_ID`. Set only on `api` (see `apps/api/wrangler.jsonc`).
- **One dedicated CLI Public OAuth (Connect) app** (production WorkOS env only today) — separate public `client_id` in `apps/cli/src/config.ts` (`client_01KSED1S5WMWBYCFWQZX2FHNED`). Tokens verify against the AuthKit domain JWKS (`/oauth2/jwks`), not `api.workos.com/sso/jwks/{client_id}`.

Preview staging env default client: `client_01KSAGD5FCYJ13KSQ7SKVBDKNB`.  
Production env default client: `client_01KSAGD5VSVFATV6ZY5CFGC6PJ`.

Do not mix preview and production credentials across Workers. Preview and production must not share `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, or WorkOS environment keys.

## Required redirect URIs

Register these in the WorkOS dashboard for the matching environment **before** deploying or changing `WORKOS_REDIRECT_URI`.

### Preview (staging WorkOS environment)

| URI                                                    | Purpose                                              |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `https://app.preview.agent-paste.sh/api/auth/callback` | Stable preview web Worker                            |
| `http://localhost:5173/api/auth/callback`              | Local `wrangler dev` / Vite dev                      |
| `https://*.preview.agent-paste.sh/api/auth/callback`   | Per-PR preview web (`pr-{N}.preview.agent-paste.sh`) |

WorkOS rejects wildcard redirect URIs on public-suffix hosts like `*.workers.dev`. Per-PR OAuth callbacks must use the `*.preview.agent-paste.sh` custom domain, not the immediate `*.workers.dev` hostname.

### Production (production WorkOS environment)

| URI                                            | Purpose                                                   |
| ---------------------------------------------- | --------------------------------------------------------- |
| `https://app.agent-paste.sh/api/auth/callback` | Production dashboard AuthKit                              |
| `http://127.0.0.1:8975/callback`               | CLI Connect app default loopback (exact default required) |

The CLI binds port `8975` by default (`AGENT_PASTE_LOGIN_PORT` overrides to another **registered** URI; WorkOS allows a wildcard loopback registration but the default must be exact).

### Worker `WORKOS_REDIRECT_URI` must match

| Worker                       | Preview value                                                                 | Production value                               |
| ---------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| `agent-paste-web-preview`    | `https://app.preview.agent-paste.sh/api/auth/callback`                        | —                                              |
| `agent-paste-web-production` | —                                                                             | `https://app.agent-paste.sh/api/auth/callback` |
| `agent-paste-web-pr-{N}`     | `https://pr-{N}.preview.agent-paste.sh/api/auth/callback` (patched at deploy) | —                                              |

AuthKit reads `WORKOS_REDIRECT_URI` from Worker vars. A mismatch between this value and the URI WorkOS redirects to after login produces callback errors (see [Callback URL drift](#callback-url-drift)).

## Worker secrets and vars inventory

### Secrets (never commit; Cloudflare does not reveal values after write)

| Name                     | Bound on     | Notes                                                                                                                                                              |
| ------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WORKOS_API_KEY`         | `api`, `web` | Server-side WorkOS API credential. Must match the target WorkOS environment. Per-PR web uses `WORKOS_PREVIEW_API_KEY` from GitHub Actions, written at deploy time. |
| `WORKOS_COOKIE_PASSWORD` | `web`        | 32+ characters. Seals AuthKit session cookie `__agp_session`. Per-PR preview derives a seed value in `deploy-pr-preview.mjs`.                                      |

Human operator access is controlled by the WorkOS `admin` role slug on the
active session.

### Vars (public deployment metadata in `wrangler.jsonc`)

| Name                  | Bound on               | Preview                                                                    | Production                                                                 |
| --------------------- | ---------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `WORKOS_CLIENT_ID`    | `api`, `web`           | `client_01KSAJTF1EX1YZCCXJS9B0GJ46`                                        | `client_01KSED0F1X2MZ0WCKNNQR6FY2X`                                        |
| `WORKOS_REDIRECT_URI` | `web`                  | `https://app.preview.agent-paste.sh/api/auth/callback`                     | `https://app.agent-paste.sh/api/auth/callback`                             |
| `WORKOS_ISSUER`       | `api`                  | `https://api.workos.com/user_management/client_01KSAGD5FCYJ13KSQ7SKVBDKNB` | `https://api.workos.com/user_management/client_01KSAGD5VSVFATV6ZY5CFGC6PJ` |
| `WORKOS_CLI_AUDIENCE` | `api`                  | `client_01KSAGD5FCYJ13KSQ7SKVBDKNB`                                        | `client_01KSAGD5VSVFATV6ZY5CFGC6PJ`                                        |
| `WORKOS_CLI_JWKS_URL` | `api`, `upload`        | `https://courageous-milestone-75-staging.authkit.app/oauth2/jwks`          | `https://soulful-path-50.authkit.app/oauth2/jwks`                          |
| `WORKOS_CLI_ISSUER`   | `api`, `upload`        | `https://courageous-milestone-75-staging.authkit.app`                      | `https://soulful-path-50.authkit.app`                                      |
| `WORKOS_MCP_JWKS_URL` | `api`, `upload`, `mcp` | `https://courageous-milestone-75-staging.authkit.app/oauth2/jwks`          | `https://soulful-path-50.authkit.app/oauth2/jwks`                          |
| `WORKOS_MCP_ISSUER`   | `api`, `upload`, `mcp` | `https://courageous-milestone-75-staging.authkit.app`                      | `https://soulful-path-50.authkit.app`                                      |
| `WORKOS_COOKIE_NAME`  | `web`                  | `__agp_session`                                                            | `__agp_session`                                                            |
| `WEB_BASE_URL`        | `web`                  | `https://app.preview.agent-paste.sh`                                       | `https://app.agent-paste.sh`                                               |

Dashboard session tokens are issued by `https://api.workos.com/user_management/{env default client}` — that path is `WORKOS_ISSUER`, **not** the AuthKit subdomain and **not** `WORKOS_CLIENT_ID`. CLI Connect tokens use `WORKOS_CLI_ISSUER` and `WORKOS_CLI_JWKS_URL`. The `upload` Worker repeats the MCP/CLI AuthKit issuer and JWKS vars so member MCP bearer tokens verify on the upload leg of `publish_artifact` / `add_revision`; `packages/repo-lint/src/upload-workos-wrangler-config.mjs` fails CI when those values drift from `api`.

JWKS for dashboard verification: `https://api.workos.com/sso/jwks/{WORKOS_CLIENT_ID}` (built in `apps/api/src/workos.ts` unless `WORKOS_JWKS_URL` overrides).

List secret binding names (values redacted):

```sh
wrangler secret list --cwd apps/api --env preview --format json
wrangler secret list --cwd apps/web --env preview --format json
wrangler secret list --cwd apps/api --env production --format json
wrangler secret list --cwd apps/web --env production --format json
```

## Redirect URI drift detection and remediation

### Symptoms

- WorkOS error page after login: redirect URI not registered or does not match.
- `/api/auth/callback` returns 4xx from AuthKit before the dashboard loads.
- Per-PR preview: login succeeds on stable preview but fails on `pr-{N}.preview.agent-paste.sh`.

### Detection

1. Compare WorkOS dashboard redirect URIs to the tables in [Required redirect URIs](#required-redirect-uris).
2. Compare deployed Worker vars:

   ```sh
   wrangler vars list --cwd apps/web --env preview
   wrangler vars list --cwd apps/web --env production
   ```

   For a PR preview Worker: check the patched `WORKOS_REDIRECT_URI` in `apps/web/dist/server/wrangler.json` after `deploy-pr-preview.mjs` runs, or inspect the WorkOS authorize redirect from browser devtools (`redirect_uri` query param).

3. Confirm custom domain routes exist: `app.preview.agent-paste.sh`, `app.agent-paste.sh`, and `pr-{N}.preview.agent-paste.sh` for deployed PR web Workers.

### Remediation

1. Add the missing URI in the WorkOS dashboard for the correct environment (preview staging vs production).
2. Update `WORKOS_REDIRECT_URI` in `apps/web/wrangler.jsonc` if the stable hostname changed; redeploy web (`pnpm deploy:preview` or production workflow).
3. For per-PR previews: ensure `https://*.preview.agent-paste.sh/api/auth/callback` remains registered in the **preview** WorkOS env. Redeploy the PR preview if the Worker var patch failed.
4. Re-test sign-in from the affected hostname.

Do not register `*.workers.dev` callback URIs for OAuth; WorkOS rejects wildcards on public suffixes.

## API key and cookie password rotation

Follow the WorkOS sections in [runbook-rotation.md](./runbook-rotation.md#rotate-workos-web-secrets):

- **`WORKOS_API_KEY`** — rotate in WorkOS dashboard, write to both `api` and `web`, verify with `pnpm smoke:web` and the target environment smoke.
- **`WORKOS_CLIENT_ID`** — project/client swap only; update Wrangler vars and secrets, configure redirect URIs in the new project first, deploy before verification.
- **`WORKOS_COOKIE_PASSWORD`** — write to `web` only; **invalidates all existing dashboard sessions** (users must sign in again).

## Common auth failure modes

Structured rejection reasons are logged as `workos_auth_reject` in `api` Worker logs (`apps/api/src/workos.ts`). Detail never includes tokens, `sub`, or email.

### Dashboard loads sign-in but `/v1/web/*` returns 401 (`not_authenticated`)

| Symptom                                         | Likely cause                                                             | Fix                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User appears signed in; dashboard API calls 401 | `WORKOS_ISSUER` points at AuthKit domain instead of User Management path | Set `WORKOS_ISSUER` to `https://api.workos.com/user_management/{WORKOS_CLI_AUDIENCE}` in `apps/api/wrangler.jsonc`; redeploy `api`. Check logs for `issuer_mismatch`.     |
| Same, with `client_id_mismatch` in logs         | `requireClientIdClaim: true` or wrong audience expectation               | Dashboard path must use `requireClientIdClaim: false` (AuthKit session tokens carry no `client_id`/`azp`/`aud`). Already set in `dashboardVerifyOptions`; do not regress. |
| Same, with `verify_threw` / JWKS errors         | Expired or wrong `WORKOS_API_KEY`, or JWKS fetch failure                 | Rotate or fix API key; confirm JWKS URL resolves: `https://api.workos.com/sso/jwks/{WORKOS_CLIENT_ID}`.                                                                   |
| Same, with `user_fetch_failed`                  | API key cannot read User Management API                                  | Confirm key matches environment; check WorkOS dashboard key status.                                                                                                       |

Historical note: production Issue A (2026-05) was `issuer_mismatch` because `WORKOS_ISSUER` used the `authkit.app` domain instead of the User Management issuer.

### Callback URL drift

| Symptom                      | Likely cause                                      | Fix                                                                                                          |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| WorkOS error at end of login | Redirect URI not in WorkOS project                | Register URI per [Required redirect URIs](#required-redirect-uris).                                          |
| AuthKit callback 4xx         | `WORKOS_REDIRECT_URI` Worker var ≠ registered URI | Align var and dashboard; redeploy `web`.                                                                     |
| PR preview login fails       | Missing wildcard or wrong `pr-{N}` host           | Register `https://*.preview.agent-paste.sh/api/auth/callback`; confirm deploy patched `WORKOS_REDIRECT_URI`. |

### Expired or revoked WorkOS API key

| Symptom                                   | Likely cause                               | Fix                                                                                   |
| ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Sign-in or callback provisioning fails    | Invalid `WORKOS_API_KEY` on `web` or `api` | Rotate key per [runbook-rotation.md](./runbook-rotation.md); update **both** Workers. |
| `user_fetch_failed` with HTTP 401 in logs | Key revoked in WorkOS dashboard            | Create new key; redeploy secrets.                                                     |

### Cookie password rotation side effects

| Symptom                              | Likely cause                                     | Fix                                                                       |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------- |
| All users signed out after deploy    | Expected after `WORKOS_COOKIE_PASSWORD` rotation | Users re-authenticate; no data loss.                                      |
| Sign-in loop or sealed-cookie errors | `web` on new password while stale cookie present | Clear site cookies for `app.{preview.}agent-paste.sh` or sign out; retry. |

### JWKS and signature verification failures

| Symptom                                                     | Likely cause                                                              | Fix                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `verify_threw` with `JWKSNoMatchingKey` or signature errors | Wrong `WORKOS_CLIENT_ID` for JWKS URL, or key rotation at WorkOS          | Confirm `WORKOS_CLIENT_ID` matches dashboard AuthKit app; JWKS cache TTL is 1h in code — redeploy or wait after WorkOS key rotation. |
| CLI login 401, `path: cli` in logs                          | Wrong `WORKOS_CLI_JWKS_URL` / `WORKOS_CLI_ISSUER` / `WORKOS_CLI_AUDIENCE` | Match vars to the AuthKit subdomain and env default client in `apps/api/wrangler.jsonc`.                                             |

### CLI login failures

| Symptom                          | Likely cause                  | Fix                                                                                     |
| -------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| Browser opens but redirect fails | Loopback URI not registered   | Register `http://127.0.0.1:8975/callback` (exact) on production WorkOS env Connect app. |
| Port in use                      | Default 8975 taken            | Set `AGENT_PASTE_LOGIN_PORT` to a registered port.                                      |
| `agent-paste login` then API 401 | Preview CLI against wrong env | Override `AGENT_PASTE_WORKOS_BASE_URL` / client id for preview staging AuthKit domain.  |

### Operator and admin surfaces

| Symptom                            | Likely cause                           | Fix                                                                          |
| ---------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `/admin` unavailable despite login | Session lacks WorkOS `admin` role      | Assign the `admin` role, then refresh/sign in again so the token carries it. |
| Operator API 404                   | Intentional non-enumeration (ADR 0046) | Confirm `admin` role session or Cloudflare Access service token.             |

### PR preview web skipped

| Symptom                                                                   | Likely cause                 | Fix                                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| PR deploy log: `WORKOS_PREVIEW_API_KEY unset; skipping per-PR web deploy` | GitHub secret not configured | Set `WORKOS_PREVIEW_API_KEY` to the preview WorkOS API key in repo secrets. API/upload/content/apex still deploy. |
| Hosted smoke skips web                                                    | No `AGENT_PASTE_PR_WEB_URL`  | Expected when web skipped; Lighthouse a11y still runs on mock WorkOS locally.                                     |

### Unauthenticated dashboard 500 (historical)

| Symptom                              | Likely cause                                    | Fix                                                                                 |
| ------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `/dashboard` 500 instead of redirect | Query string on thrown TanStack Router redirect | Fixed: `_authed` redirects through `/api/auth/sign-in/p/{encoded}` (#59 follow-up). |

## Verification commands

Run from repo root after config or secret changes.

### Local web auth smoke (mock WorkOS + API callback path)

```sh
pnpm smoke:web
```

Exercises `POST /v1/auth/web/callback`, dashboard loaders, and WorkOS token verification without live WorkOS credentials.

### Hosted preview

```sh
AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET=... pnpm smoke:preview
```

Includes `smokeWebAuth`: `/healthz` 200 and `/api/auth/sign-in` 307 with `Location` under `https://api.workos.com/user_management/authorize` on `app.preview.agent-paste.sh` (override with `AGENT_PASTE_PREVIEW_WEB_URL`).

### Hosted production

```sh
AGENT_PASTE_PRODUCTION_SMOKE_API_KEY=... pnpm smoke:production
```

Same web auth checks against `app.agent-paste.sh`.

### Manual spot checks

```sh
# Web Worker health (no cookies)
curl -fsS -o /dev/null -w "%{http_code}\n" https://app.preview.agent-paste.sh/healthz

# Sign-in entry redirects to WorkOS User Management
curl -sI https://app.preview.agent-paste.sh/api/auth/sign-in | grep -i location
```

After browser login: confirm `/dashboard` loads and Network tab shows `/v1/web/workspace` 200. In `api` logs, confirm absence of fresh `workos_auth_reject` events.

### Full gate before merge

```sh
pnpm verify
```

## Done criteria

This runbook satisfies Phase 3 backlog item 5 when:

- Preview and production WorkOS env layout, redirect URIs, and Worker bindings are documented here.
- Rotation steps defer to [runbook-rotation.md](./runbook-rotation.md) without duplicating full procedures.
- Common failure modes map symptoms to fixes using live hostnames and public identifiers from [web-app-todo.md](./web-app-todo.md).
- Verification commands are listed and tied to existing smoke scripts.

Status promotion (ADR coverage, implementation ledger) is tracked separately in [phase-backlog.md](./status/phase-backlog.md) item 6.
