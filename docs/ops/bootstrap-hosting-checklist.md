# Bootstrap Hosting Checklist

Click-ops checklist for the items still open under backlog item #8 (Complete bootstrap hosting checklist) in [`project-status.md`](./project-status.md). Drives [ADR 0058](../adr/0058-first-deploy-schema-and-secret-bootstrap.md) and [ADR 0014](../adr/0014-single-domain-with-hardened-content-subdomain.md).

Audience: Isaac. Every step is human-only (DNS console, Bitwarden vault, GitHub environment UI). Agents cannot execute these. Total wall time once values are pre-staged: ~30 minutes.

Prerequisites (pre-stage before starting):

- [ ] `gh` authenticated to `zaks-io` (`gh auth status` shows the org).
- [ ] `bw unlock` run; `$BW_SESSION` exported in the same shell that runs the `bw get password ...` calls in section 4.
- [ ] `jq`, `dig`, `curl`, `openssl` on `$PATH`.
- [ ] Cloudflare console session for account `a461d640900eb3905d7b6619c8c0da91`.
- [ ] GitHub admin access to `zaks-io/agent-paste`.
- [ ] Bitwarden collection `agent-paste / production` exists (create empty if not).

Scope:

- DNS cutover on `agent-paste.sh` (Cloudflare account `a461d640900eb3905d7b6619c8c0da91`).
- Bitwarden capture of every production Worker secret and GitHub Actions secret.
- GitHub `Production` environment approval policy + branch restriction.
- End-to-end verification via `pnpm smoke:production`.

Out of scope:

- Worker code, migrations, or CI workflow changes.
- Auth0 tenant config (Phase 3+; see [ADR 0066](../adr/0066-cli-first-mvp-contract-narrowing.md)).
- Logpush -> Axiom wiring (covered by item #6 / `runbook-logpush.md`).
- Secret rotation cadence (covered by [ADR 0045](../adr/0045-secret-rotation-cadence-and-on-demand-tooling.md)).

## 1. DNS on `agent-paste.sh`

### 1a. Confirm nameservers

- [ ] Registrar shows Cloudflare nameservers for `agent-paste.sh`. In the Cloudflare dashboard for account `a461d640900eb3905d7b6619c8c0da91`, the zone `agent-paste.sh` must read `Active`.
- [ ] If the zone reads `Pending`, copy the two assigned `*.ns.cloudflare.com` hosts from the Cloudflare zone overview into the registrar's nameserver fields and wait for propagation (typically <1h).

### 1b. Custom-domain records

Wrangler creates these records automatically when `deploy:production` runs against a Worker whose `wrangler.jsonc` declares `custom_domain: true`. The checklist below is a verify-only pass against what is already deployed.

Pulled from each `apps/*/wrangler.jsonc` `env.production.routes`:

| Record (FQDN)                        | Type | Target Worker                    | Source                                  |
| ------------------------------------ | ---- | -------------------------------- | --------------------------------------- |
| `agent-paste.sh` (apex)              | AAAA | `agent-paste-apex-production`    | `apps/apex/wrangler.jsonc`              |
| `api.agent-paste.sh`                 | AAAA | `agent-paste-api-production`     | `apps/api/wrangler.jsonc`               |
| `upload.agent-paste.sh`              | AAAA | `agent-paste-upload-production`  | `apps/upload/wrangler.jsonc`            |
| `usercontent.agent-paste.sh`         | AAAA | `agent-paste-content-production` | `apps/content/wrangler.jsonc`           |
| `preview.agent-paste.sh`             | AAAA | `agent-paste-apex-preview`       | `apps/apex/wrangler.jsonc` (preview)    |
| `api.preview.agent-paste.sh`         | AAAA | `agent-paste-api-preview`        | `apps/api/wrangler.jsonc` (preview)     |
| `upload.preview.agent-paste.sh`      | AAAA | `agent-paste-upload-preview`     | `apps/upload/wrangler.jsonc` (preview)  |
| `usercontent.preview.agent-paste.sh` | AAAA | `agent-paste-content-preview`    | `apps/content/wrangler.jsonc` (preview) |

Verify in Cloudflare dashboard -> `agent-paste.sh` -> Workers Routes / DNS:

- [ ] Every row above shows status `Active` with proxy `Workers` (orange-cloud).
- [ ] No `CNAME` pointing at `*.workers.dev` for any production hostname (Wrangler should be managing direct routes).
- [ ] CAA records (if any) include `letsencrypt.org` and `pki.goog` so Cloudflare-managed certs can issue.

External smoke (works once DNS resolves and TLS provisions):

```sh
for host in agent-paste.sh api.agent-paste.sh upload.agent-paste.sh usercontent.agent-paste.sh; do
  echo "-- $host"
  dig +short "$host" AAAA
  curl -fsS -o /dev/null -w "  HTTP %{http_code}  cert=%{ssl_verify_result}\n" "https://$host/healthz" || true
done
```

`ssl_verify_result=0` means the cert validates. `404` on apex `/healthz` is fine (no such route); `200` on the three subdomain `/healthz` calls confirms Workers are wired.

## 2. Bitwarden vault entries

Every secret in the table below must exist in the Bitwarden `agent-paste / production` collection before this checklist is considered Done. Cross-checked against `apps/*/wrangler.jsonc` (Worker bindings), `scripts/bootstrap-secrets.mjs` (auto-minted Worker secrets), `.github/workflows/deploy-production.yml` (GitHub-side secrets), and `docs/ops/project-status.md` § GitHub.

### Worker secrets (minted by `scripts/bootstrap-secrets.mjs`)

Run once per environment:

```sh
OPERATOR_EMAILS=isaac@isaacsuttell.com pnpm bootstrap:production
```

The script prints every value to stdout exactly once. Capture before closing the terminal.

| Name                     | Bound on (production Worker)                                                                    | Origin                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `CONTENT_SIGNING_SECRET` | `agent-paste-api-production`, `agent-paste-upload-production`, `agent-paste-content-production` | `scripts/bootstrap-secrets.mjs` (random 48 bytes, base64url)                            |
| `UPLOAD_SIGNING_SECRET`  | `agent-paste-upload-production`                                                                 | `scripts/bootstrap-secrets.mjs` (random 48 bytes, base64url)                            |
| `API_KEY_PEPPER_V1`      | `agent-paste-api-production`, `agent-paste-upload-production`                                   | `scripts/bootstrap-secrets.mjs` (random 48 bytes, base64url)                            |
| `ADMIN_TOKEN`            | Operator only (not bound on any Worker)                                                         | `scripts/bootstrap-secrets.mjs` (`ap_admin_<base64url>`)                                |
| `ADMIN_TOKEN_HASH`       | `agent-paste-api-production`                                                                    | `scripts/bootstrap-secrets.mjs` (HMAC-SHA256 of `ADMIN_TOKEN` with `API_KEY_PEPPER_V1`) |
| `OPERATOR_EMAILS`        | `agent-paste-api-production`                                                                    | Supplied via `OPERATOR_EMAILS=` env var on the bootstrap run                            |

Bitwarden entry checklist:

- [ ] `agent-paste / production / ADMIN_TOKEN` -- the only post-bootstrap copy. Lose it and the only path back is `bootstrap:production --force`, which invalidates every issued credential. Treat as P1.
- [ ] `agent-paste / production / CONTENT_SIGNING_SECRET`
- [ ] `agent-paste / production / UPLOAD_SIGNING_SECRET`
- [ ] `agent-paste / production / API_KEY_PEPPER_V1`
- [ ] `agent-paste / production / ADMIN_TOKEN_HASH` (recomputable from the two above, store anyway)
- [ ] `agent-paste / production / OPERATOR_EMAILS`

### Infrastructure secrets (set manually, not by bootstrap script)

These come from external consoles and must be entered into Cloudflare / GitHub by hand. Generate where noted.

| Name                                 | Where used                                                     | How to generate / source                                                                                                                                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`              | GitHub Actions (`deploy-production.yml`)                       | Fixed: `a461d640900eb3905d7b6619c8c0da91`. Org-inherited from `zaks-io`; confirm via `gh secret list --org zaks-io` (token may lack org-secret read; if so, trust the workflow run output).                                                                 |
| `CLOUDFLARE_API_TOKEN`               | GitHub Actions (`deploy-production.yml`)                       | Cloudflare dashboard -> My Profile -> API Tokens -> Create. Scopes: `Workers Scripts: Edit`, `Workers Routes: Edit`, `Workers KV Storage: Edit`, `Workers R2 Storage: Edit`, `Hyperdrive: Edit`, `Account Settings: Read`, `Zone:Read` on `agent-paste.sh`. |
| `NEON_API_KEY`                       | GitHub Actions (PR preview branch lifecycle)                   | Neon console -> Account Settings -> API Keys -> Generate. Org-scoped, not project-scoped.                                                                                                                                                                   |
| `NEON_PROJECT_ID`                    | GitHub Actions (PR preview)                                    | Fixed: `still-forest-91029005`.                                                                                                                                                                                                                             |
| `NEON_PRODUCTION_BRANCH_ID`          | GitHub Actions (production migration target)                   | Neon console -> project `still-forest-91029005` -> Branches -> copy the `br_xxxxx` ID of the `production` branch.                                                                                                                                           |
| `PRODUCTION_DATABASE_URL`            | GitHub `Production` env (`deploy-production.yml` migrate step) | Neon console -> production branch -> Connection details -> Direct (NOT pooled), role `platform_admin`.                                                                                                                                                      |
| `AGENT_PASTE_PRODUCTION_ADMIN_TOKEN` | GitHub `Production` env (`deploy-production.yml` smoke step)   | Same value as `ADMIN_TOKEN` above. Copy from Bitwarden into the GitHub environment secret.                                                                                                                                                                  |
| `TURBO_TOKEN`                        | All workflows (remote cache)                                   | `zaks-io` org secret. Already present.                                                                                                                                                                                                                      |
| `TURBO_TEAM`                         | All workflows (remote cache)                                   | `zaks-io` org var. Value: `zaks-io`.                                                                                                                                                                                                                        |
| `TURBO_REMOTE_CACHE_SIGNATURE_KEY`   | All workflows (remote cache integrity)                         | Generate once: `openssl rand -hex 32`. Set as repo or org secret.                                                                                                                                                                                           |
| `CLOUDFLARE_WORKERS_SUBDOMAIN`       | PR preview workflows                                           | Fixed: `isaac-a46` (the `*.workers.dev` subdomain).                                                                                                                                                                                                         |

Bitwarden entry checklist (one per row):

- [ ] `agent-paste / infra / CLOUDFLARE_API_TOKEN`
- [ ] `agent-paste / infra / NEON_API_KEY`
- [ ] `agent-paste / infra / NEON_PRODUCTION_BRANCH_ID`
- [ ] `agent-paste / infra / PRODUCTION_DATABASE_URL` (production-branch direct URL, NOT pooled)
- [ ] `agent-paste / infra / TURBO_REMOTE_CACHE_SIGNATURE_KEY`

`CLOUDFLARE_ACCOUNT_ID`, `NEON_PROJECT_ID`, `CLOUDFLARE_WORKERS_SUBDOMAIN`, `TURBO_TEAM` are non-sensitive identifiers. They do not belong in Bitwarden, but workflows still need them. The `gh secret set` block below sets `NEON_PROJECT_ID` and `CLOUDFLARE_WORKERS_SUBDOMAIN`. `CLOUDFLARE_ACCOUNT_ID` and `TURBO_TEAM` are inherited from the `zaks-io` GitHub org; verify with `gh secret list --org zaks-io` and `gh variable list --org zaks-io`.

### GitHub secret mirror

After Bitwarden is populated, mirror the production secrets into GitHub:

```sh
gh secret set CLOUDFLARE_API_TOKEN          --repo zaks-io/agent-paste --body "$(...)"
gh secret set NEON_API_KEY                  --repo zaks-io/agent-paste --body "$(...)"
gh secret set NEON_PROJECT_ID               --repo zaks-io/agent-paste --body still-forest-91029005
gh secret set NEON_PRODUCTION_BRANCH_ID     --repo zaks-io/agent-paste --body "$(...)"
gh secret set TURBO_REMOTE_CACHE_SIGNATURE_KEY --repo zaks-io/agent-paste --body "$(...)"
gh secret set CLOUDFLARE_WORKERS_SUBDOMAIN  --repo zaks-io/agent-paste --body isaac-a46

# Production-environment-scoped (NOT repo-scoped):
gh secret set PRODUCTION_DATABASE_URL           --repo zaks-io/agent-paste --env Production --body "$(...)"
gh secret set AGENT_PASTE_PRODUCTION_ADMIN_TOKEN --repo zaks-io/agent-paste --env Production --body "$(...)"
```

Verify:

```sh
gh secret list --repo zaks-io/agent-paste
gh secret list --repo zaks-io/agent-paste --env Production
```

## 3. GitHub `Production` environment approval policy

The environment name is `Production` (exact case, from `.github/workflows/deploy-production.yml` line 34: `environment: Production`). The `deploy:` job will not run until the environment exists and its policy is satisfied.

In the GitHub UI: `zaks-io/agent-paste` -> Settings -> Environments -> `Production`.

- [ ] **Required reviewers**: add `isaac-zaks` (or the Isaac user account that owns the repo) as the sole reviewer. Toggle "Prevent self-review" OFF -- this is a solo-dev project and the reviewer is also the pusher.
- [ ] **Wait timer**: `5 minutes`. Gives a window to cancel an in-flight deploy if a regression slips through CI.
- [ ] **Deployment branches and tags**: select `Selected branches and tags`, add rule `main` (exact match). Reject all other refs.
- [ ] **Environment secrets**: confirm `PRODUCTION_DATABASE_URL` and `AGENT_PASTE_PRODUCTION_ADMIN_TOKEN` are listed under "Environment secrets" (not "Repository secrets") for this environment.
- [ ] **Environment variables**: none required.
- [ ] **Admin bypass**: disabled. Isaac is also the admin; the bypass would defeat the wait timer.

Verify via API:

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

```sh
AGENT_PASTE_PRODUCTION_ADMIN_TOKEN="$(bw get password 'agent-paste / production / ADMIN_TOKEN')" \
  pnpm smoke:production
```

Pass criteria (the script asserts each line; failure throws):

- Workspace create returns an `id`.
- API key create returns a secret prefixed `ap_pk_production_`.
- `publish` returns `artifact_id` (`art_*`), `revision_id` (`rev_*`), a `view_url` rooted at `https://usercontent.agent-paste.sh`, and an `agent_view_url` rooted at `https://api.agent-paste.sh`.
- Agent View JSON lists `index.html`.
- Agent View HTML returns `200` with `Content-Type: text/html`.
- Content URL returns `200` HTML matching the smoke fixture.
- Apex `https://agent-paste.sh/` returns `200` HTML with no cookies, plus `/llms.txt` (`text/plain`) and `/agents.md` (`text/markdown`).
- Final cleanup: `artifact delete` succeeds and the view URL returns `404`.

### 4b. Manual curl fallback (if `pnpm smoke:production` fails before exit)

```sh
TOKEN="$(bw get password 'agent-paste / production / ADMIN_TOKEN')"

# 1. API health
curl -fsS https://api.agent-paste.sh/healthz | jq .

# 2. Admin workspace create (idempotent on the same Idempotency-Key)
curl -fsS -X POST https://api.agent-paste.sh/admin/workspaces \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: bootstrap-checklist-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{"owner_email":"isaac@isaacsuttell.com","name":"Bootstrap Verify"}' | jq .

# 3. Apex
curl -fsS -o /dev/null -w "apex / %{http_code}\n"             https://agent-paste.sh/
curl -fsS -o /dev/null -w "apex /llms.txt %{http_code}\n"    https://agent-paste.sh/llms.txt
curl -fsS -o /dev/null -w "apex /agents.md %{http_code}\n"   https://agent-paste.sh/agents.md

# 4. Upload health
curl -fsS -o /dev/null -w "upload / %{http_code}\n"          https://upload.agent-paste.sh/healthz

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

- [ ] Workflow run pauses with status `waiting` and a "Review pending deployment" prompt in the GitHub UI.
- [ ] After approval, the 5-minute wait timer ticks down before the job starts.
- [ ] Job completes green; `Smoke production` step passes.

## Done criteria

Item #8 in `project-status.md` is Done when:

- All checkboxes in sections 1-3 are checked.
- `pnpm smoke:production` exits 0 from a clean local checkout.
- `gh api repos/zaks-io/agent-paste/environments/Production` returns the expected protection rules.
- `gh secret list --repo zaks-io/agent-paste --env Production` lists `PRODUCTION_DATABASE_URL` and `AGENT_PASTE_PRODUCTION_ADMIN_TOKEN`.
- Bitwarden `agent-paste / production` collection holds the six Worker secrets plus the five infra secrets.

When closing: move item #8 to the Recently Completed section in `project-status.md` and link back to this checklist.
