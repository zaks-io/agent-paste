# Secret Rotation Runbook

Operator runbook for rotating deployed Worker secrets in `preview` or `production`. Runtime code in `@agent-paste/rotation` implements the ADR 0045 overlap model (verify-old → sign-new → drain → drop-old); this document describes how to drive that model with Wrangler bindings.

Use this runbook for emergency or planned manual rotation. Do not use `scripts/bootstrap-secrets.mjs` for routine rotation; bootstrap is first-deploy only and refuses to overwrite existing secrets unless forced.

## Automated overlap tooling

Operator scripts implement the ADR 0045 staging → flip → drain → drop sequence. They never read secret values back from Cloudflare; capture generated or dashboard material in a password manager before closing the terminal. Do not pass real secret values through `--value` when using the `pnpm secrets:rotate:*` aliases: pnpm echoes argv. Put the value in an environment variable and pass `--value-env <NAME>` instead.

| Profile                  | Script entrypoint                                                              | Workers touched                    |
| ------------------------ | ------------------------------------------------------------------------------ | ---------------------------------- |
| Content signing          | `node scripts/rotate-versioned-secret.mjs content-signing <env> --step <step>` | `api`, `upload`, `content`         |
| Upload signing           | `node scripts/rotate-versioned-secret.mjs upload-signing <env> --step <step>`  | `upload`                           |
| API Key pepper           | `node scripts/rotate-versioned-secret.mjs api-key-pepper <env> --step <step>`  | `api`, `upload`                    |
| Artifact-byte encryption | `node scripts/rotate-versioned-secret.mjs artifact-bytes-encryption <env> ...` | `api`, `upload`, `content`, `jobs` |
| WorkOS API key           | `node scripts/rotate-workos-secrets.mjs workos-api-key <env> --value-env NAME` | `api`, `mcp`, `upload`, `web`      |
| WorkOS cookie password   | `node scripts/rotate-workos-secrets.mjs workos-cookie-password <env> ...`      | `web`                              |

Convenience aliases (append `--step stage|flip|drain|drop` and `--dry-run` as needed):

```sh
pnpm secrets:rotate:content-signing:preview -- --step stage --dry-run
pnpm secrets:rotate:api-key-pepper:preview -- --step flip
pnpm secrets:rotate:workos-api-key:preview -- --dry-run --value-env WORKOS_ROTATION_SECRET
```

Steps:

1. **`--step stage`** — `wrangler secret put` the `*_V2` binding on every Worker in the profile. Keep the active kid var at `v1`.
2. **`--step flip`** — `wrangler deploy --var <KID_VAR>:v2` on each Worker so new mints use kid `2`.
3. **`--step drain`** — plan-only wait guidance (no wrangler writes). Follow the profile-specific TTL notes below.
4. **`--step drop`** — signing profiles: promote the staged value into the primary secret, deploy `--var <KID_VAR>:v1`, then `wrangler secret delete` the `_V2` name (requires `--value-env <promoted-secret-env-var>` when using pnpm aliases). Kid-persisting profiles (`api-key-pepper`, `artifact-bytes-encryption`): delete the primary (kid 1) secret, keep `_V2`, leave `<KID_VAR>` at `v2` (no value input).
5. **`--step emergency`** — single-step cutover (invalidates overlap). Requires `--value-env` and `--force` with typed confirmation when overwriting an existing primary through pnpm aliases.

Set `--operator <email-or-rotation-agent@platform>` for ops-log attribution. The default machine identity is `rotation-agent@platform` per ADR 0046. Mutating steps append a JSON line to `var/ops/rotation-audit.jsonl` (gitignored) with operator, profile, target, and step.

`@agent-paste/rotation` tests exercise overlap and promotion collapse in CI (`packages/rotation/src/automation.test.ts`). Do not run hosted smokes or live secret writes unless the Linear ticket explicitly approves credentials.

## Current Inventory

| Secret                          | Bound on                   | Rotation impact                                                                                                  |
| ------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CONTENT_SIGNING_SECRET`        | api, upload, content       | Invalidates currently minted content and Agent View URLs.                                                        |
| `UPLOAD_SIGNING_SECRET`         | upload                     | Invalidates in-flight signed upload PUT URLs.                                                                    |
| `ACCESS_LINK_SIGNING_KEY_V1`    | api                        | Signs Access Link Signed URLs; old URLs remain valid until their `exp` or the signing kid is dropped.            |
| `ARTIFACT_BYTES_ENCRYPTION_KEY` | api, upload, content, jobs | Required for artifact-byte encrypt/decrypt; existing R2 ciphertext stays on its original `enc_kid` per ADR 0063. |
| `API_KEY_PEPPER_V1`             | api, upload                | Invalidates existing API Keys in the current MVP implementation.                                                 |
| `WORKOS_API_KEY`                | api, mcp, upload, web      | Swaps the WorkOS server-side API credential.                                                                     |
| `WORKOS_CLIENT_ID`              | api, web                   | Project/client swap only; also update Wrangler vars where present.                                               |
| `WORKOS_COOKIE_PASSWORD`        | web                        | Invalidates existing AuthKit sealed web sessions.                                                                |

Human operator access is controlled by the WorkOS `admin` role slug on the
active session.

## Explicit Exclusions

Do not create or rotate these names for the CLI-first MVP:

- `WEB_SESSION_SEAL_KEY_V1`: removed with the WorkOS AuthKit migration. The current web session seal is WorkOS AuthKit's `WORKOS_COOKIE_PASSWORD`.
- Auth0 client/session secrets for `apps/web`: superseded by WorkOS AuthKit before a deployed login path existed.

Access Link signed URLs are active. Do not treat `ACCESS_LINK_SIGNING_KEY_V1`,
`ACCESS_LINK_SIGNING_KEY_V2`, or `ACCESS_LINK_SIGNING_KID` as excluded.

## First-time bind (existing environments)

Initial binding of `ARTIFACT_BYTES_ENCRYPTION_KEY` is handled by `scripts/deploy.mjs` (ADR 0078): on the next deploy it generates the key if missing and binds the same value on `api`, `upload`, `content`, and `jobs`, without re-running bootstrap.

```sh
node scripts/deploy.mjs preview
node scripts/deploy.mjs production
```

Run from an operator machine with Wrangler auth; the value is never printed or stored in the repo. Objects written before the bind are not retroactively encrypted; they remain in their original R2 format until re-encrypted or lifecycle removes them. New encrypted uploads and reads require the key. To _rotate_ it (not initial bind), use `rotate-versioned-secret.mjs artifact-bytes-encryption`.

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

## Fail-Loud Active KID Invariant

The active `*_KID` Worker var is part of the signing configuration. A partial flip
where `*_KID` points at `v2` before the matching `*_V2` secret is bound is a
deploy/config failure and intentionally hard-fails during key-ring construction
or first signer resolution. Do not paper over it by falling back to kid `1`,
another signing key, or verify-only mode; that hides a critical rotation drift
and can mint tokens with a non-active key.

Recovery is one of two actions:

1. Bind the missing active secret everywhere that signed-token profile needs it,
   redeploy the affected Workers, then rerun the hosted smoke.
2. Roll the `*_KID` var back to the previous fully-bound kid, redeploy the
   affected Workers, then rerun the hosted smoke.

The named active secret must exist before the flip:

- `CONTENT_SIGNING_KID=v2` requires `CONTENT_SIGNING_SECRET_V2` on `api`,
  `upload`, and `content`.
- `UPLOAD_SIGNING_KID=v2` requires `UPLOAD_SIGNING_SECRET_V2` on `upload`.
- `ACCESS_LINK_SIGNING_KID=v2` requires `ACCESS_LINK_SIGNING_KEY_V2` wherever
  Access Link Signed URLs are minted or verified.

Errors should name only the missing or inconsistent kid and binding names, never
secret values.

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
5. **Drop kid `1`:** after legacy keys under `pepper_kid = 1` are retired, `wrangler secret delete API_KEY_PEPPER_V1` on `api` and `upload`, keep `API_KEY_PEPPER_V2` bound, leave `API_KEY_PEPPER_CURRENT_KID` at `v2`, and deploy. Rows with `pepper_kid = 2` keep verifying; do not relabel stored `pepper_kid` values to `1`.
6. Run hosted smoke.

Emergency cutover (invalidates all existing API Keys): replace `API_KEY_PEPPER_V1` on both Workers, leave `API_KEY_PEPPER_V2` unset, reset `API_KEY_PEPPER_CURRENT_KID` to `v1`, and reissue keys.

## Rotate WorkOS Web Secrets

Current status: WorkOS AuthKit is the current web auth stack. Preview and production WorkOS login work; the remaining Phase 3 web items are tracked in [`status/phase-backlog.md`](./status/phase-backlog.md#active-phase-3-close-out) and [`web-app-todo.md`](./web-app-todo.md).

### `WORKOS_API_KEY`

1. Create or rotate the API key in the WorkOS dashboard for the target environment's WorkOS project.
2. Store the new value in the password manager.
3. Write it to `api`, `mcp`, `upload`, and `web` during a maintenance window. There is a short propagation window where one service can be on the new WorkOS key while another is still on the old one, so update the bearer-verifying backend services first, then the frontend:

   ```sh
   wrangler secret put WORKOS_API_KEY --cwd apps/api --env preview
   wrangler secret put WORKOS_API_KEY --cwd apps/mcp --env preview
   wrangler secret put WORKOS_API_KEY --cwd apps/upload --env preview
   wrangler secret put WORKOS_API_KEY --cwd apps/web --env preview
   ```

4. Verify the WorkOS login and MCP bearer paths after the writes. Run `pnpm smoke:web`, `pnpm smoke:mcp`, plus the hosted environment smoke for the target environment.

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
