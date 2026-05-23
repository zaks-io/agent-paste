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

`OPERATOR_EMAILS` is an operator allowlist value, not a cryptographic secret, but it is written through Worker secret bindings today and should be checked during rotation.

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
  wrangler secret list --name agent-paste-api-preview --json
  wrangler secret list --name agent-paste-upload-preview --json
  wrangler secret list --name agent-paste-content-preview --json
  wrangler secret list --name agent-paste-web-preview --json
  ```

- After writing, run the environment smoke test with the new admin token:

  ```sh
  AGENT_PASTE_PREVIEW_ADMIN_TOKEN=... pnpm smoke:preview
  AGENT_PASTE_PRODUCTION_ADMIN_TOKEN=... pnpm smoke:production
  ```

## Rotate Content Signing

Current status: `CONTENT_SIGNING_SECRET` is a single shared HMAC secret with no active `kid` overlap primitive. Rotating it invalidates previously minted `view_url`, file URLs, and signed public Agent View URLs.

Procedure:

1. Pick a maintenance window. Treat old public content URLs as expiring immediately after the cut.
2. Generate a new high-entropy base64url value and store it in the password manager.
3. Write the same value to all three Workers:

   ```sh
   wrangler secret put CONTENT_SIGNING_SECRET --name agent-paste-api-preview
   wrangler secret put CONTENT_SIGNING_SECRET --name agent-paste-upload-preview
   wrangler secret put CONTENT_SIGNING_SECRET --name agent-paste-content-preview
   ```

4. Repeat for `production` only when intentionally rotating production.
5. Run hosted smoke. Confirm new publish output fetches through `content`.
6. Tell active operators that any cached old signed URLs must be reminted by fetching fresh Agent View or publishing again.

Future ADR 0045 work should replace this with staged verify-old/sign-new/drop-old `kid` support.

## Rotate Upload Signing

Current status: `UPLOAD_SIGNING_SECRET` is used only by `upload` for signed PUT URLs.

Procedure:

1. Stop starting new upload sessions for the target environment if there is active traffic.
2. Wait for in-flight signed upload URLs to expire. The default `UPLOAD_URL_TTL_SECONDS` is 900 seconds in Wrangler config.
3. Generate and store a new high-entropy base64url value.
4. Write it to `upload`:

   ```sh
   wrangler secret put UPLOAD_SIGNING_SECRET --name agent-paste-upload-preview
   ```

5. Run hosted smoke. Failed old PUT URLs are expected; clients should create a new upload session.

## Rotate API Key Pepper

Current status: API key rows store `pepper_kid`, but the runtime verifies with only `API_KEY_PEPPER_V1`. Rotating the pepper in the current MVP invalidates existing API Keys and changes the HMAC input for `ADMIN_TOKEN_HASH`.

Procedure:

1. Plan this as an emergency credential reset or a coordinated API-key replacement window.
2. Generate and store a new `API_KEY_PEPPER_V1`.
3. Generate a new one-time `ADMIN_TOKEN` shaped `ap_admin_<base64url>`.
4. Compute `ADMIN_TOKEN_HASH` as HMAC-SHA-256 of the raw `ADMIN_TOKEN` with the new pepper, base64url encoded.
5. Write the new pepper to `api` and `upload`, then the new admin hash to `api`:

   ```sh
   wrangler secret put API_KEY_PEPPER_V1 --name agent-paste-api-preview
   wrangler secret put API_KEY_PEPPER_V1 --name agent-paste-upload-preview
   wrangler secret put ADMIN_TOKEN_HASH --name agent-paste-api-preview
   ```

6. Run hosted smoke with the new admin token. The smoke creates a fresh workspace API Key under the new pepper.
7. Reissue any needed long-lived API Keys. Existing keys minted under the previous pepper are expected to fail.

Future ADR 0045 work should add multi-pepper verification and a tested rehash/lazy-migration path before this becomes non-disruptive.

## Rotate Admin Token Only

Use this when the admin bearer token is exposed but the API key pepper is still trusted.

Procedure:

1. Generate a new `ADMIN_TOKEN` shaped `ap_admin_<base64url>` and store it in the password manager.
2. Compute `ADMIN_TOKEN_HASH` with the current `API_KEY_PEPPER_V1`.
3. Write only the hash:

   ```sh
   wrangler secret put ADMIN_TOKEN_HASH --name agent-paste-api-preview
   ```

4. Run hosted smoke with the new admin token.
5. Remove the old raw admin token from operator machines and password-manager history where possible.

## Rotate WorkOS Web Secrets

Current status: WorkOS AuthKit is the current web auth stack, but the dashboard remains a scaffold until the WorkOS project click-ops and API member resolution are finished.

### `WORKOS_API_KEY`

1. Create or rotate the API key in the WorkOS dashboard for the target environment's WorkOS project.
2. Store the new value in the password manager.
3. Write it to both `api` and `web`:

   ```sh
   wrangler secret put WORKOS_API_KEY --name agent-paste-api-preview
   wrangler secret put WORKOS_API_KEY --name agent-paste-web-preview
   ```

4. Run the focused web smoke when available; until then, run `pnpm --filter @agent-paste/web typecheck` plus the hosted MVP smoke.

### `WORKOS_CLIENT_ID`

Rotate this only for a WorkOS project/client swap.

1. Configure redirect URIs in the new WorkOS project before switching.
2. Update `WORKOS_CLIENT_ID` in both Worker secrets and the matching `apps/api` / `apps/web` Wrangler vars.
3. Deploy the config change and verify login against the new WorkOS project.

### `WORKOS_COOKIE_PASSWORD`

1. Generate and store a new 32+ character password.
2. Write it to `web`:

   ```sh
   wrangler secret put WORKOS_COOKIE_PASSWORD --name agent-paste-web-preview
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
- known invalidation: content URLs, upload URLs, API Keys, admin token, or web sessions
