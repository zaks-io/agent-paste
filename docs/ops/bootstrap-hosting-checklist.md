# Bootstrap Hosting Checklist

Click-ops checklist for the parked hosted-ops items now summarized in [`status/hosted-ops.md`](./status/hosted-ops.md). Drives [ADR 0058](../adr/0058-first-deploy-schema-and-secret-bootstrap.md) and [ADR 0014](../adr/0014-single-domain-with-hardened-content-subdomain.md).

Audience: Isaac + Codex. Total wall time once values are pre-staged: ~30 minutes.

Ownership markers:

- **Codex can handle**: I can execute this from the local workspace once the required CLI auth and source secret values are available. Networked commands may require approval; `gh` commands require the outside-sandbox GitHub auth context.
- **Codex can verify**: I can run read-only checks from the terminal, but Isaac must fix failures that require a registrar, vendor console, MFA, or account-owner UI.
- **Isaac only**: Requires human account ownership, console/MFA interaction, deploy approval, Bitwarden vault work, or creating/copying a secret value that should remain in Isaac's custody.

Quick split:

- **Codex can handle most terminal work**: local tool checks, DNS/TLS smoke, generated secrets, GitHub secret mirroring from provided env vars, GitHub environment policy setup where the API supports it, production smoke, workflow watching, and final doc updates.
- **Isaac owns the sensitive click-ops**: Bitwarden vault entry/storage, registrar nameserver changes, Cloudflare/Neon token creation, Neon production database URL copy, and approving the pending production deployment.
- **GitHub note**: `gh` is authenticated outside the sandbox, so Codex can use it only by running the relevant command with escalation approval.

Prerequisites (pre-stage before starting):

- [ ] `gh` authenticated to `zaks-io` (`gh auth status` shows the org). **Codex can verify** with an escalated/out-of-sandbox command; Isaac handles login/MFA if missing.
- [ ] Secret source is available for terminal steps that need values. There is no `bw` path for Codex in this setup; use manually exported env vars for Codex-run GitHub mirroring/smoke, and Isaac updates the vault separately. **Isaac only** for vault work.
- [ ] `jq`, `dig`, `curl`, `openssl` on `$PATH`. **Codex can handle**.
- [ ] Cloudflare console session for account `a461d640900eb3905d7b6619c8c0da91`. **Isaac only**.
- [ ] GitHub admin access to `zaks-io/agent-paste`. **Codex can verify**; Isaac grants/fixes access if missing.
- [ ] Bitwarden collection `agent-paste / production` exists (create empty if not). **Isaac only**.

Scope:

- DNS cutover on `agent-paste.sh` (Cloudflare account `a461d640900eb3905d7b6619c8c0da91`).
- Bitwarden capture of every production Worker secret and GitHub Actions secret.
- GitHub `Production` environment approval policy + branch restriction.
- End-to-end verification via `pnpm smoke:production`.

Out of scope:

- Worker code, migrations, or CI workflow changes.
- WorkOS project config (Phase 3+; see [ADR 0068](../adr/0068-workos-authkit-for-web-app-auth.md)).
- Logpush -> Axiom wiring (covered by item #2 / `runbook-logpush.md`).
- Stable preview custom domains. PR preview lifecycle is tracked separately in [`status/hosted-ops.md`](./status/hosted-ops.md).
- Secret rotation cadence (covered by [ADR 0045](../adr/0045-secret-rotation-cadence-and-on-demand-tooling.md)).

## 1. DNS on `agent-paste.sh`

Live check on 2026-05-22: production DNS is not a blocker. Public DNS reports Cloudflare nameservers (`kay.ns.cloudflare.com`, `koa.ns.cloudflare.com`), the production hostnames resolve to Cloudflare anycast AAAA records, TLS validates, and these routes return `200`: `https://agent-paste.sh/`, `https://api.agent-paste.sh/openapi.json`, `https://upload.agent-paste.sh/openapi.json`, and `https://usercontent.agent-paste.sh/openapi.json`.

### 1a. Confirm nameservers

- [x] Registrar shows Cloudflare nameservers for `agent-paste.sh`. In the Cloudflare dashboard for account `a461d640900eb3905d7b6619c8c0da91`, the zone `agent-paste.sh` must read `Active`. **Codex verified** public nameservers on 2026-05-22; Isaac owns registrar changes if this ever regresses.
- [ ] If the zone reads `Pending`, copy the two assigned `*.ns.cloudflare.com` hosts from the Cloudflare zone overview into the registrar's nameserver fields and wait for propagation (typically <1h). **Isaac only**.

### 1b. Custom-domain records

Wrangler creates these records automatically when `deploy:production` runs against a Worker whose `wrangler.jsonc` declares `custom_domain: true`. The checklist below is a verify-only pass against what is already deployed.

Pulled from each `apps/*/wrangler.jsonc` `env.production.routes`:

| Record (FQDN)                | Type | Target Worker                    | Source                        |
| ---------------------------- | ---- | -------------------------------- | ----------------------------- |
| `agent-paste.sh` (apex)      | AAAA | `agent-paste-apex-production`    | `apps/apex/wrangler.jsonc`    |
| `api.agent-paste.sh`         | AAAA | `agent-paste-api-production`     | `apps/api/wrangler.jsonc`     |
| `upload.agent-paste.sh`      | AAAA | `agent-paste-upload-production`  | `apps/upload/wrangler.jsonc`  |
| `usercontent.agent-paste.sh` | AAAA | `agent-paste-content-production` | `apps/content/wrangler.jsonc` |

Verify in Cloudflare dashboard -> `agent-paste.sh` -> Workers Routes / DNS:

- [x] Production rows above show status `Active` with proxy `Workers` (orange-cloud). **Codex verified** public DNS/TLS/Worker responses on 2026-05-22; Isaac can use the dashboard if API access is unavailable.
- [x] No `CNAME` pointing at `*.workers.dev` for any production hostname (Wrangler should be managing direct routes). **Codex verified** production hostnames resolve through Cloudflare AAAA records on 2026-05-22.
- [x] CAA records (if any) include `letsencrypt.org` and `pki.goog` so Cloudflare-managed certs can issue. **Codex verified** no CAA records are currently present on 2026-05-22, so Cloudflare-managed cert issuance is not restricted.

External smoke (works once DNS resolves and TLS provisions):

**Codex can handle** this smoke from the terminal.

```sh
for host in agent-paste.sh api.agent-paste.sh upload.agent-paste.sh usercontent.agent-paste.sh; do
  echo "-- $host"
  dig +short "$host" AAAA
done

curl -fsS -o /dev/null -w "apex / %{http_code} cert=%{ssl_verify_result}\n" \
  https://agent-paste.sh/
curl -fsS -o /dev/null -w "api /openapi.json %{http_code} cert=%{ssl_verify_result}\n" \
  https://api.agent-paste.sh/openapi.json
curl -fsS -o /dev/null -w "upload /openapi.json %{http_code} cert=%{ssl_verify_result}\n" \
  https://upload.agent-paste.sh/openapi.json
curl -fsS -o /dev/null -w "content /openapi.json %{http_code} cert=%{ssl_verify_result}\n" \
  https://usercontent.agent-paste.sh/openapi.json
```

`ssl_verify_result=0` means the cert validates. `200` on apex `/` and the three subdomain `/openapi.json` calls confirms the Cloudflare custom domains, certificates, and Worker routes are wired. The MVP `api`/`upload`/`content` Workers do not expose `/healthz`.

## 2. Bitwarden vault entries

Every secret in the table below must exist in the Bitwarden `agent-paste / production` collection before this checklist is considered Done. Cross-checked against `apps/*/wrangler.jsonc` (Worker bindings), `scripts/bootstrap-secrets.mjs` (auto-minted Worker secrets), `.github/workflows/deploy-production.yml` (GitHub-side secrets), and [`status/hosted-ops.md`](./status/hosted-ops.md).

### Worker secrets (minted by `scripts/bootstrap-secrets.mjs`)

Run once per environment:

**Codex can handle** this only if Cloudflare auth is already available and Isaac is comfortable with the one-time secret output passing through this workspace. Otherwise **Isaac only** should run it and paste/store the values directly in Bitwarden.

```sh
pnpm bootstrap:production
```

The script prints every value to stdout exactly once. Capture before closing the terminal.

| Name                            | Bound on (production Worker)                                                                     | Origin                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `CONTENT_SIGNING_SECRET`        | `agent-paste-api-production`, `agent-paste-upload-production`, `agent-paste-content-production`  | `scripts/bootstrap-secrets.mjs` (random 48 bytes, base64url)                          |
| `UPLOAD_SIGNING_SECRET`         | `agent-paste-upload-production`                                                                  | `scripts/bootstrap-secrets.mjs` (random 48 bytes, base64url)                          |
| `ARTIFACT_BYTES_ENCRYPTION_KEY` | `agent-paste-upload-production`, `agent-paste-content-production`, `agent-paste-jobs-production` | `scripts/bootstrap-secrets.mjs` (random 48 bytes, base64url; one value for all three) |
| `API_KEY_PEPPER_V1`             | `agent-paste-api-production`, `agent-paste-upload-production`                                    | `scripts/bootstrap-secrets.mjs` (random 48 bytes, base64url)                          |

Bitwarden entry checklist:

- [ ] `agent-paste / production / CONTENT_SIGNING_SECRET`. **Isaac only**.
- [ ] `agent-paste / production / UPLOAD_SIGNING_SECRET`. **Isaac only**.
- [ ] `agent-paste / production / ARTIFACT_BYTES_ENCRYPTION_KEY` (same value on upload, content, jobs). **Isaac only**.
- [ ] `agent-paste / production / API_KEY_PEPPER_V1`. **Isaac only**.

### Infrastructure secrets (set manually, not by bootstrap script)

These come from external consoles and must be entered into Cloudflare / GitHub by hand. Generate where noted.

Ownership: Isaac creates or copies `CLOUDFLARE_API_TOKEN` and `PRODUCTION_DATABASE_URL` from vendor consoles. **Codex can handle** fixed IDs, random local generation, GitHub secret mirroring, and verification once the sensitive values are available through the current shell.

| Name                                   | Where used                                                     | How to generate / source                                                                                                                                                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`                | GitHub Actions (`deploy-production.yml`)                       | Fixed: `a461d640900eb3905d7b6619c8c0da91`. Org-inherited from `zaks-io`; confirm via `gh secret list --org zaks-io` (token may lack org-secret read; if so, trust the workflow run output).                                                                 |
| `CLOUDFLARE_API_TOKEN`                 | GitHub Actions (`deploy-production.yml`)                       | Cloudflare dashboard -> My Profile -> API Tokens -> Create. Scopes: `Workers Scripts: Edit`, `Workers Routes: Edit`, `Workers KV Storage: Edit`, `Workers R2 Storage: Edit`, `Hyperdrive: Edit`, `Account Settings: Read`, `Zone:Read` on `agent-paste.sh`. |
| `DATABASE_URL_MIGRATIONS_PRODUCTION`   | GitHub `Production` env (`deploy-production.yml` migrate step) | Neon console -> production branch -> Connection details -> Direct (NOT pooled), role `platform_admin`. Legacy name `PRODUCTION_DATABASE_URL` still works until rotated.                                                                                     |
| `DATABASE_URL_RUNTIME_PRODUCTION`      | Operator / Hyperdrive maintenance only                         | Neon console -> production branch -> Direct, role `app_role`. Used when updating Hyperdrive; not stored in deploy workflows. See [`runbook-neon-database-roles.md`](./runbook-neon-database-roles.md).                                                      |
| `AGENT_PASTE_PRODUCTION_SMOKE_API_KEY` | GitHub `Production` env (`deploy-production.yml` smoke step)   | Long-lived publish/read API key provisioned for production smoke only (not the harness). Store in Bitwarden and mirror to GitHub.                                                                                                                           |
| `TURBO_TOKEN`                          | Optional remote cache for trusted CI / deploy workflows        | `zaks-io` org secret when inherited, or repo secret if org inheritance is unavailable. PR validation falls back to local cache when absent; public external PR CI is intentionally disabled until a no-secret path exists.                                  |
| `TURBO_TEAM`                           | Optional remote cache for trusted CI / deploy workflows        | `zaks-io` org var (`zaks-io`) when inherited, or repo variable if org inheritance is unavailable. PR validation falls back to local cache when absent; public external PR CI is intentionally disabled until a no-secret path exists.                       |
| `TURBO_REMOTE_CACHE_SIGNATURE_KEY`     | All workflows (remote cache integrity)                         | Generate once: `openssl rand -hex 32`. Set as repo or org secret.                                                                                                                                                                                           |

PR-preview-only values (`NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_PRODUCTION_BRANCH_ID`, `CLOUDFLARE_WORKERS_SUBDOMAIN`) are intentionally not production blockers.

Bitwarden entry checklist (one per row):

- [ ] `agent-paste / infra / CLOUDFLARE_API_TOKEN`. **Isaac only** to create in Cloudflare and store in Bitwarden; **Codex can handle** GitHub storage after the value is available in the shell.
- [ ] `agent-paste / infra / DATABASE_URL_MIGRATIONS_PRODUCTION` (production-branch direct URL, NOT pooled, role `platform_admin`). **Isaac only** to copy from Neon and store in Bitwarden unless a CLI/API credential is already available; **Codex can handle** GitHub storage after the value is available in the shell.
- [ ] `agent-paste / infra / DATABASE_URL_RUNTIME_PRODUCTION` (`app_role`, for Hyperdrive only). **Isaac only** for Neon copy; update Hyperdrive configs after `0010_db_roles.sql` is applied.
- [ ] `agent-paste / infra / TURBO_REMOTE_CACHE_SIGNATURE_KEY`. **Codex can handle** generation, GitHub storage, and verification; Isaac stores it in Bitwarden.

`CLOUDFLARE_ACCOUNT_ID` and `TURBO_TEAM` are non-sensitive identifiers. They do not belong in Bitwarden, but production workflows still need them. Both are inherited from the `zaks-io` GitHub org; verify with `gh secret list --org zaks-io` and `gh variable list --org zaks-io` when the token has org Actions secret/variable permissions. A successful production deploy also proves they are available to the workflow.

### GitHub secret mirror

After Bitwarden is populated, mirror the production secrets into GitHub:

**Codex can handle** this block after `gh` auth is available outside the sandbox and the secret values are exported in the shell. It will require escalation approval for the `gh secret set` commands.

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo zaks-io/agent-paste --body "$CLOUDFLARE_API_TOKEN"
gh secret set TURBO_REMOTE_CACHE_SIGNATURE_KEY --repo zaks-io/agent-paste --body "$TURBO_REMOTE_CACHE_SIGNATURE_KEY"

# Production-environment-scoped (NOT repo-scoped):
gh secret set DATABASE_URL_MIGRATIONS_PRODUCTION --repo zaks-io/agent-paste --env Production --body "$DATABASE_URL_MIGRATIONS_PRODUCTION"
gh secret set AGENT_PASTE_PRODUCTION_SMOKE_API_KEY --repo zaks-io/agent-paste --env Production --body "$AGENT_PASTE_PRODUCTION_SMOKE_API_KEY"
```

Verify:

```sh
gh secret list --repo zaks-io/agent-paste
gh secret list --repo zaks-io/agent-paste --env Production
```

## 3. GitHub `Production` environment approval policy

The environment name is `Production` (exact case, from `.github/workflows/deploy-production.yml` line 34: `environment: Production`). The `deploy:` job will not run until the environment exists and its policy is satisfied.

In the GitHub UI: `zaks-io/agent-paste` -> Settings -> Environments -> `Production`.

- [ ] **Required reviewers**: add `isaac-zaks` (or the Isaac user account that owns the repo) as the sole reviewer. Toggle "Prevent self-review" OFF -- this is a solo-dev project and the reviewer is also the pusher. **Codex can handle** via `gh api` if the reviewer account is confirmed and API permissions allow it; Isaac uses the UI if GitHub rejects the toggle.
- [ ] **Wait timer**: `5 minutes`. Gives a window to cancel an in-flight deploy if a regression slips through CI. **Codex can handle** via `gh api`.
- [ ] **Deployment branches and tags**: select `Selected branches and tags`, add rule `main` (exact match). Reject all other refs. **Codex can handle** via `gh api`.
- [ ] **Environment secrets**: confirm `DATABASE_URL_MIGRATIONS_PRODUCTION` and `AGENT_PASTE_PRODUCTION_SMOKE_API_KEY` are listed under "Environment secrets" (not "Repository secrets") for this environment. **Codex can handle** after `gh` auth is available outside the sandbox.
- [ ] **Environment variables**: none required. **Codex can verify**.
- [ ] **Admin bypass**: disabled. Isaac is also the admin; the bypass would defeat the wait timer. **Codex can verify**; Isaac uses the UI if API access cannot set/confirm it.

Verify via API:

**Codex can handle** this verification.

```sh
gh api repos/zaks-io/agent-paste/environments/Production \
  --jq '{reviewers: .protection_rules[] | select(.type == "required_reviewers") | .reviewers,
          wait_timer: .protection_rules[] | select(.type == "wait_timer") | .wait_timer,
          branches: .deployment_branch_policy}'
```

Expected: `wait_timer == 5`, `branches.protected_branches == false`, `branches.custom_branch_policies == true`, with `main` in the policy list (fetched separately via `gh api repos/zaks-io/agent-paste/environments/Production/deployment-branch-policies`).

## 4. Verification

Run end-to-end after steps 1-3 are checked off.

### 4a. Production smoke

**Codex can handle** this after `AGENT_PASTE_PRODUCTION_SMOKE_API_KEY` is exported in the shell and network approval is granted.

```sh
: "${AGENT_PASTE_PRODUCTION_SMOKE_API_KEY:?export the production smoke API key first}"
pnpm smoke:production
```

Pass criteria (the script asserts each line; failure throws):

- `whoami` resolves the smoke workspace.
- API key is prefixed `ap_pk_production_` (pre-provisioned secret).
- `publish` returns `artifact_id` (`art_*`), `revision_id` (`rev_*`), an `artifact_url` rooted at `https://app.agent-paste.sh`, a `revision_content_url` and `view_url` rooted at `https://usercontent.agent-paste.sh`, and an `agent_view_url` rooted at `https://api.agent-paste.sh`.
- Agent View JSON lists `index.html`.
- Agent View HTML returns `200` with `Content-Type: text/html`.
- Content URL returns `200` HTML matching the smoke fixture.
- Apex `https://agent-paste.sh/` returns `200` HTML with no cookies, plus `/llms.txt` (`text/plain`) and `/agents.md` (`text/markdown`).
- Production smoke skips destructive artifact delete (harness routes are disabled in production).

### 4b. Manual curl fallback (if `pnpm smoke:production` fails before exit)

**Codex can handle** this fallback when network approval is granted.

```sh
# 1. API public route
curl -fsS https://api.agent-paste.sh/openapi.json | jq .openapi

# 2. Apex
curl -fsS -o /dev/null -w "apex / %{http_code}\n"             https://agent-paste.sh/
curl -fsS -o /dev/null -w "apex /llms.txt %{http_code}\n"    https://agent-paste.sh/llms.txt
curl -fsS -o /dev/null -w "apex /agents.md %{http_code}\n"   https://agent-paste.sh/agents.md

# 4. Upload public route
curl -fsS -o /dev/null -w "upload /openapi.json %{http_code}\n" https://upload.agent-paste.sh/openapi.json

# 5. Content sanity (expect 404, NOT 401/500: content rejects unknown tokens with 404)
curl -fsS -o /dev/null -w "content unknown %{http_code}\n"   https://usercontent.agent-paste.sh/v/invalid/x
```

All `%{http_code}` values must be `200` except the final one which must be `404`.

### 4c. Confirm GitHub deploy gate fires

Trigger a manual production deploy and confirm the approval prompt appears:

```sh
gh workflow run "Deploy Production" --repo zaks-io/agent-paste --ref main
gh run watch --repo zaks-io/agent-paste
```

- [ ] Workflow run pauses with status `waiting` and a "Review pending deployment" prompt in the GitHub UI. **Codex can handle** trigger/watch; Isaac must review the pending deployment.
- [ ] After approval, the 5-minute wait timer ticks down before the job starts. **Isaac only** to approve; **Codex can verify** the timer behavior.
- [ ] Job completes green; `Smoke production` step passes. **Codex can handle** watching and reporting the result.

## Done criteria

This checklist is Done when:

- All checkboxes in sections 1-3 are checked.
- `pnpm smoke:production` exits 0 from a clean local checkout.
- `gh api repos/zaks-io/agent-paste/environments/Production` returns the expected protection rules.
- `gh secret list --repo zaks-io/agent-paste --env Production` lists `DATABASE_URL_MIGRATIONS_PRODUCTION` and `AGENT_PASTE_PRODUCTION_SMOKE_API_KEY`.
- Bitwarden holds the production Worker secrets under `agent-paste / production` plus the production infra secrets under `agent-paste / infra`.

When closing: update [`status/hosted-ops.md`](./status/hosted-ops.md), [`status/phase-backlog.md`](./status/phase-backlog.md), and [`status/changelog.md`](./status/changelog.md) with a link back to this checklist. **Codex can handle** the final doc update after the mixed-owner checks are complete.
