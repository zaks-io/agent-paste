# Secret Rotation Runbook

This is the MVP operator runbook for rotating deployed Worker secrets in `preview` or `production`. It is the ADR 0045 groundwork slice for the current runtime, not the final automated `kid`-overlap tooling.

Use this runbook for emergency or planned manual rotation. Do not use `scripts/bootstrap-secrets.mjs` for routine rotation; bootstrap is first-deploy only and refuses to overwrite existing secrets unless forced.

## Current Inventory

| Secret                   | Bound on             | Rotation impact                                                                 |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------- |
| `CONTENT_SIGNING_SECRET` | api, upload, content | Invalidates currently minted content and Agent View URLs.                       |
| `UPLOAD_SIGNING_SECRET`  | upload               | Invalidates in-flight signed upload PUT URLs.                                   |
| `API_KEY_PEPPER_V1`      | api, upload          | Invalidates existing API Keys in the current MVP implementation.                |
| `ADMIN_TOKEN_HASH`       | api                  | Replaces the repo-local admin bearer token hash; the raw token is never stored. |
| `WORKOS_API_KEY`         | api, web             | Swaps the WorkOS server-side API credential.                                    |
| `WORKOS_CLIENT_ID`       | api, web             | Project/client swap only; also update Wrangler vars where present.              |
| `WORKOS_COOKIE_PASSWORD` | web                  | Invalidates existing AuthKit sealed web sessions.                               |

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
  wrangler secret list --cwd apps/api --env preview --json
  wrangler secret list --cwd apps/upload --env preview --json
  wrangler secret list --cwd apps/content --env preview --json
  wrangler secret list --cwd apps/web --env preview --json
  ```

- After writing, run the environment smoke test with the new admin token:

  ```sh
  AGENT_PASTE_PREVIEW_ADMIN_TOKEN=... pnpm smoke:preview
  AGENT_PASTE_PRODUCTION_ADMIN_TOKEN=... pnpm smoke:production
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

Current status: `CONTENT_SIGNING_SECRET` is a single shared HMAC secret with no active `kid` overlap primitive. Rotating it invalidates previously minted `view_url`, file URLs, and signed public Agent View URLs.

Procedure:

1. Pick a maintenance window. Treat old public content URLs as expiring immediately after the cut.
2. Generate a new high-entropy base64url value and store it in the password manager.
3. Write the same value to all three Workers. There is a seconds-to-minutes propagation window where signers and verifier can disagree, so schedule this during low traffic. Update the verifier first, then signers:

   ```sh
   wrangler secret put CONTENT_SIGNING_SECRET --cwd apps/content --env preview
   wrangler secret put CONTENT_SIGNING_SECRET --cwd apps/upload --env preview
   wrangler secret put CONTENT_SIGNING_SECRET --cwd apps/api --env preview
   ```

4. Repeat for `production` only when intentionally rotating production.
5. Run hosted smoke. Confirm new publish output fetches through `content`.
6. Tell active operators that any cached old signed URLs must be reminted by fetching fresh Agent View or publishing again.

Future ADR 0045 work should replace this with staged verify-old/sign-new/drop-old `kid` support.

## Rotate Upload Signing

Current status: `UPLOAD_SIGNING_SECRET` is used only by `upload` for signed PUT URLs.

Procedure:

1. There is no built-in upload pause mechanism today. Schedule the rotation during a low-traffic window, using Workers metrics, logs, or normal off-hours to confirm low session-create and finalize traffic.
2. Wait for in-flight signed upload URLs to expire. The default `UPLOAD_URL_TTL_SECONDS` is 900 seconds in Wrangler config.
3. Generate and store a new high-entropy base64url value.
4. Write it to `upload`:

   ```sh
   wrangler secret put UPLOAD_SIGNING_SECRET --cwd apps/upload --env preview
   ```

5. Run hosted smoke. Failed old PUT URLs are expected; clients should create a new upload session.

## Rotate API Key Pepper

Current status: API key rows store `pepper_kid`, but the runtime verifies with only `API_KEY_PEPPER_V1`. Rotating the pepper in the current MVP invalidates existing API Keys and changes the HMAC input for `ADMIN_TOKEN_HASH`.

Procedure:

1. Plan this as an emergency credential reset or a coordinated API-key replacement window.
2. Generate and store a new `API_KEY_PEPPER_V1`.
3. Generate a new one-time `ADMIN_TOKEN` shaped `ap_admin_<base64url>`.
4. Compute `ADMIN_TOKEN_HASH` as HMAC-SHA-256 of the raw `ADMIN_TOKEN` with the new pepper, base64url encoded. Use `hmacBase64Url()` in `scripts/bootstrap-secrets.mjs` as the implementation reference; do not run the bootstrap script for rotation.
5. Write the new pepper and admin hash to `api` together, then write the pepper to `upload`. Transient auth failures are possible until both Workers have the new pepper, and no new API Key should be issued until both writes complete:

   ```sh
   wrangler secret put API_KEY_PEPPER_V1 --cwd apps/api --env preview
   wrangler secret put ADMIN_TOKEN_HASH --cwd apps/api --env preview
   wrangler secret put API_KEY_PEPPER_V1 --cwd apps/upload --env preview
   ```

6. Run hosted smoke with the new admin token. The smoke creates a fresh workspace API Key under the new pepper.
7. Reissue any needed long-lived API Keys. Existing keys minted under the previous pepper are expected to fail.

Future ADR 0045 work should add multi-pepper verification and a tested rehash/lazy-migration path before this becomes non-disruptive.

## Rotate Admin Token Only

Use this when the admin bearer token is exposed but the API key pepper is still trusted.

Procedure:

1. Generate a new `ADMIN_TOKEN` shaped `ap_admin_<base64url>` and store it in the password manager.
2. Compute `ADMIN_TOKEN_HASH` with the current `API_KEY_PEPPER_V1`, using `hmacBase64Url()` in `scripts/bootstrap-secrets.mjs` as the implementation reference.
3. Write only the hash:

   ```sh
   wrangler secret put ADMIN_TOKEN_HASH --cwd apps/api --env preview
   ```

4. Run hosted smoke with the new admin token.
5. Remove the old raw admin token from operator machines and password-manager history where possible.

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
