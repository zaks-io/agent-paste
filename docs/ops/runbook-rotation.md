# Secret Rotation Runbook

Operator runbook for rotating deployed Worker secrets in `preview` or `production`. Runtime code in `@agent-paste/rotation` implements the ADR 0045 overlap model (verify-old → sign-new → drain → drop-old); this document describes how to drive that model with Wrangler bindings.

Use this runbook for emergency or planned manual rotation. Do not use `scripts/bootstrap-secrets.mjs` for routine rotation; bootstrap is first-deploy only and refuses to overwrite existing secrets unless forced.

## Current Inventory

| Secret                   | Bound on             | Rotation impact                                                    |
| ------------------------ | -------------------- | ------------------------------------------------------------------ |
| `CONTENT_SIGNING_SECRET` | api, upload, content | Invalidates currently minted content and Agent View URLs.          |
| `UPLOAD_SIGNING_SECRET`  | upload               | Invalidates in-flight signed upload PUT URLs.                      |
| `API_KEY_PEPPER_V1`      | api, upload          | Invalidates existing API Keys in the current MVP implementation.   |
| `WORKOS_API_KEY`         | api, web             | Swaps the WorkOS server-side API credential.                       |
| `WORKOS_CLIENT_ID`       | api, web             | Project/client swap only; also update Wrangler vars where present. |
| `WORKOS_COOKIE_PASSWORD` | web                  | Invalidates existing AuthKit sealed web sessions.                  |

Human operator access is controlled by the WorkOS `admin` role slug on the
active session.

## Explicit Exclusions

Do not create or rotate these names for the CLI-first MVP:

- `ACCESS_LINK_SIGNING_KEY_V1`: Access Link signed URLs are deferred; the current app does not mint this key.
- `WEB_SESSION_SEAL_KEY_V1`: removed with the WorkOS AuthKit migration. The current web session seal is WorkOS AuthKit's `WORKOS_COOKIE_PASSWORD`.
- Auth0 client/session secrets for `apps/web`: superseded by WorkOS AuthKit before a deployed login path existed.

## Guardrails

- Generate replacement values in a password manager or a local terminal session that will not be logged.
- Never commit secret values, captured terminal output, `.env` files, password-manager exports, or Wrangler secret JSON.
- Rotate one environment at a time. `preview` and `production` must not share values.
- Before writing, capture the current secret names only:

  ```sh
  wrangler secret list --cwd apps/api --env preview --format json
  wrangler secret list --cwd apps/upload --env preview --format json
  wrangler secret list --cwd apps/content --env preview --format json
  wrangler secret list --cwd apps/web --env preview --format json
  ```

- After writing, run the environment smoke test:

  ```sh
  AGENT_PASTE_PREVIEW_SMOKE_HARNESS_SECRET=... pnpm smoke:preview   # shared preview Workers
  AGENT_PASTE_PR_SMOKE_HARNESS_SECRET=... pnpm smoke:pr             # PR Workers; falls back to preview secret
  AGENT_PASTE_PRODUCTION_SMOKE_API_KEY=... pnpm smoke:production
  ```

- If smoke fails, roll back the changed secret bindings from the previous password-manager values, not from `wrangler secret list` output. Check formatting and encoding for the secret named by the failure, confirm cross-Worker shared secrets match when required, rerun the relevant smoke test, then collect Worker logs and escalate if the rollback smoke still fails.

## Verify Operator Role

Do this once during each rotation window.

1. Confirm the expected human operators have the WorkOS `admin` role slug in the
   target WorkOS environment.
2. Ask affected operators to refresh/sign in again so the session access token
   carries the current role claim.
3. Run the operator smoke for `/admin` and `/v1/web/admin/lockdowns`.

## Rotate Content Signing

Current status: `content`, `upload`, and `api` load a signing key ring from `CONTENT_SIGNING_SECRET` (kid `1`) and optional `CONTENT_SIGNING_SECRET_V2` (kid `2`). The active signing kid is the Worker var `CONTENT_SIGNING_KID` (`v1` or `v2`). During overlap, `content` verifies tokens minted with either secret; `api` and `upload` sign only with the active kid.

Procedure (staged overlap — existing URLs keep working until you drop kid `1`):

1. Pick a maintenance window. Plan for at least the longest content-token TTL (default 15 minutes) plus operator buffer before dropping kid `1`.
2. Generate a new high-entropy base64url value (`secret-v2`) and store it in the password manager.
3. **Stage verify-only:** add the new secret to every worker that signs or verifies content tokens without flipping signers:

   ```sh
   wrangler secret put CONTENT_SIGNING_SECRET_V2 --cwd apps/content --env preview
   wrangler secret put CONTENT_SIGNING_SECRET_V2 --cwd apps/api --env preview
   wrangler secret put CONTENT_SIGNING_SECRET_V2 --cwd apps/upload --env preview
   ```

   Leave `CONTENT_SIGNING_KID` at `v1` on `api`, `upload`, and `content` vars. Do not set `CONTENT_SIGNING_KID` to `v2` until `CONTENT_SIGNING_SECRET_V2` is bound on all three Workers.

4. **Flip signers:** set `CONTENT_SIGNING_KID` to `v2` in Wrangler vars for `api`, `upload`, and `content`, then deploy those Workers so new URLs mint with kid `2`. Keep `CONTENT_SIGNING_SECRET` (kid `1`) bound on all three Workers during overlap.
5. **Drain:** wait until no in-flight content token signed with kid `1` can still be valid (max TTL).
6. **Drop old kid (promote, then unbind `_V2` only):** after kid `1` tokens have drained, do **not** remove or unbind the primary `CONTENT_SIGNING_SECRET` while `CONTENT_SIGNING_KID` still points at `v2`. Promote the v2 value into `CONTENT_SIGNING_SECRET` on `api`, `upload`, and `content`; reset `CONTENT_SIGNING_KID` to `v1`; deploy all three Workers; verify runtime consistency (hosted smoke, spot-check a freshly minted URL); only then delete `CONTENT_SIGNING_SECRET_V2` from each Worker.
7. Run hosted smoke. Confirm new publish output fetches through `content`.
8. Tell active operators that URLs minted before the overlap window eventually expire at token `exp` or when kid `1` is dropped.

Emergency cutover (invalidates old URLs immediately): overwrite `CONTENT_SIGNING_SECRET` on all three Workers with a single new value, leave `CONTENT_SIGNING_SECRET_V2` unset, and reset `CONTENT_SIGNING_KID` to `v1` on `api`, `upload`, and `content` before deploy. Use only when overlap is not possible.

## Rotate Upload Signing

Current status: `upload` uses `UPLOAD_SIGNING_SECRET` (kid `1`), optional `UPLOAD_SIGNING_SECRET_V2` (kid `2`), and `UPLOAD_SIGNING_KID` for the active signing kid. Overlap matches content signing: verify both, sign with active kid only.

Procedure:

1. Schedule during low upload traffic. Wait for in-flight signed upload URLs to expire before dropping kid `1`. The default `UPLOAD_URL_TTL_SECONDS` is 900 seconds in Wrangler config.
2. Generate and store `secret-v2` (base64url).
3. **Stage:** `wrangler secret put UPLOAD_SIGNING_SECRET_V2 --cwd apps/upload --env preview` (keep `UPLOAD_SIGNING_KID` at `v1`). Do not set `UPLOAD_SIGNING_KID` to `v2` until `UPLOAD_SIGNING_SECRET_V2` is bound.
4. **Flip:** set `UPLOAD_SIGNING_KID` to `v2` in Wrangler vars and deploy `upload`.
5. **Drain:** wait for kid `1` upload tokens to expire.
6. **Drop:** after kid `1` upload tokens have drained, promote the v2 value into `UPLOAD_SIGNING_SECRET`, reset `UPLOAD_SIGNING_KID` to `v1`, deploy `upload`, verify runtime consistency, and only then delete `UPLOAD_SIGNING_SECRET_V2`. Do not remove or unbind the primary `UPLOAD_SIGNING_SECRET` before promotion and deploy complete.
7. Run hosted smoke.

Emergency cutover (invalidates in-flight upload URLs immediately):

1. Overwrite `UPLOAD_SIGNING_SECRET`, leave `UPLOAD_SIGNING_SECRET_V2` unset, and reset `UPLOAD_SIGNING_KID` to `v1` before deploy.
2. Run hosted smoke.

## Rotate API Key Pepper

Current status: `api_keys.pepper_kid` records which pepper signed each row. `api` and `upload` load `API_KEY_PEPPER_V1`, optional `API_KEY_PEPPER_V2`, and `API_KEY_PEPPER_CURRENT_KID` (`v1` / `v2`). Existing API Keys keep verifying with their stored `pepper_kid` during overlap; only new keys use the promoted kid.

Procedure (non-disruptive overlap):

1. Generate and store a new pepper (`pepper-v2`).
2. **Stage verify-only:** write the new pepper to both Workers before flipping minting:

   ```sh
   wrangler secret put API_KEY_PEPPER_V2 --cwd apps/api --env preview
   wrangler secret put API_KEY_PEPPER_V2 --cwd apps/upload --env preview
   ```

   Keep `API_KEY_PEPPER_CURRENT_KID` at `v1`.

3. **Flip minting:** set `API_KEY_PEPPER_CURRENT_KID` to `v2` in Wrangler vars for `api` and `upload`, then deploy. New API Keys persist `pepper_kid = 2`. Do not set `API_KEY_PEPPER_CURRENT_KID` to `v2` until `API_KEY_PEPPER_V2` is bound on both Workers.
4. **Drain:** wait for operational confidence that no API Keys under `pepper_kid = 1` are still needed (or reissue long-lived keys).
5. **Drop kid `1`:** after legacy keys under `pepper_kid = 1` are retired, promote the v2 pepper into `API_KEY_PEPPER_V1` on `api` and `upload`, reset `API_KEY_PEPPER_CURRENT_KID` to `v1`, deploy both Workers, verify runtime consistency, and only then delete `API_KEY_PEPPER_V2`. Do not remove or unbind `API_KEY_PEPPER_V1` while `API_KEY_PEPPER_CURRENT_KID` still points at `v2`.
6. Run hosted smoke.

Emergency cutover (invalidates all existing API Keys): replace `API_KEY_PEPPER_V1` on both Workers, leave `API_KEY_PEPPER_V2` unset, reset `API_KEY_PEPPER_CURRENT_KID` to `v1`, and reissue keys.

## Rotate WorkOS Web Secrets

Current status: WorkOS AuthKit is the current web auth stack. Preview and production WorkOS login work; the remaining Phase 3 web items are tracked in [`status/phase-backlog.md`](./status/phase-backlog.md#active-phase-3-close-out) and [`web-app-todo.md`](./web-app-todo.md).

### `WORKOS_API_KEY`

1. Create or rotate the API key in the WorkOS dashboard for the target environment's WorkOS project.
2. Store the new value in the password manager.
3. Write it to both `api` and `web` during a maintenance window. There is a short propagation window where one service can be on the new WorkOS key while the other is still on the old one, so update the backend first, then the frontend:

   ```sh
   wrangler secret put WORKOS_API_KEY --cwd apps/api --env preview
   wrangler secret put WORKOS_API_KEY --cwd apps/web --env preview
   ```

4. Verify both services after the writes. Run `pnpm smoke:web` plus the hosted environment smoke for the target environment.

### `WORKOS_CLIENT_ID`

Rotate this only for a WorkOS project/client swap.

1. Configure redirect URIs in the new WorkOS project before switching.
2. Update `WORKOS_CLIENT_ID` in both Worker secrets and the matching `apps/api` / `apps/web` Wrangler vars.
3. Deploy the Wrangler var changes before verification. For preview, run `pnpm deploy:preview`. For production, merge through `deploy-production.yml` rather than doing an ad hoc local production deploy.
4. Verify login against the new WorkOS project.

### `WORKOS_COOKIE_PASSWORD`

1. Generate and store a new 32+ character password.
2. Write it to `web`:

   ```sh
   wrangler secret put WORKOS_COOKIE_PASSWORD --cwd apps/web --env preview
   ```

3. Expect existing dashboard sessions to be invalidated and require sign-in again.

## Completion Record

For each rotation, record in the ops log:

- environment
- secret name
- reason: routine, emergency, or project/client swap
- operator
- timestamp
- verification command and result
- WorkOS `admin` role verified for human operators
- known invalidation: content URLs, upload URLs, API Keys, admin token, or web sessions
