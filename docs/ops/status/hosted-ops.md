# Hosted Ops

Last updated: 2026-05-27.

## Environment

- Cloudflare account id: `a461d640900eb3905d7b6619c8c0da91`.
- Domain: `agent-paste.sh` on Cloudflare nameservers.
- Neon project: `still-forest-91029005`.
- GitHub org/repo: `zaks-io/agent-paste`.
- npm org/package: `@zaks-io/agent-paste` is reserved as a public placeholder
  package for CLI distribution; the installed command remains `agent-paste`.

## Deployed / Routed Workers

| Worker surface | Current status                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `apex`         | Marketing/apex route live at `agent-paste.sh`.                                                                                               |
| `api`          | Preview/production deployed; owns control plane, web APIs, and operator APIs.                                                                |
| `upload`       | Preview/production deployed; owns upload sessions and R2 writes.                                                                             |
| `content`      | Preview/production deployed; owns `usercontent` content reads.                                                                               |
| `web`          | Preview and production deployed at `app.preview.agent-paste.sh` and `app.agent-paste.sh`.                                                    |
| `jobs`         | Preview/production deployed; queue consumers and lifecycle sweeps active.                                                                    |
| `mcp`          | Preview/production Workers configured; deploy after `api`/`upload`. Hosted smoke via `pnpm smoke:mcp:preview` / `pnpm smoke:mcp:production`. |

## Secrets

`scripts/bootstrap-secrets.mjs` writes MVP secrets and optional web secrets. Use
`--with-web` only when all WorkOS inputs are available. For live-update rollout on
an existing environment, use targeted scripts instead of re-running bootstrap:

- `scripts/set-stream-internal-secret.mjs` — `STREAM_INTERNAL_SECRET` on `api` and `stream`
- `scripts/set-artifact-bytes-encryption-secret.mjs` — `ARTIFACT_BYTES_ENCRYPTION_KEY` on `upload`, `content`, and `jobs`

| Secret                          | Bound on              | Notes                                                                                              |
| ------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `CONTENT_SIGNING_SECRET`        | api, upload, content  | Active content-token and Agent View signing secret.                                                |
| `UPLOAD_SIGNING_SECRET`         | upload                | Active upload PUT token signing secret.                                                            |
| `ARTIFACT_BYTES_ENCRYPTION_KEY` | upload, content, jobs | Root key for per-workspace artifact-byte AES-256-GCM (ADR 0063). Same value on all three Workers.  |
| `API_KEY_PEPPER_V1`             | api, upload           | Active API-key HMAC pepper.                                                                        |
| `SMOKE_HARNESS_SECRET`          | api (preview/PR)      | Non-production smoke harness only; never set on production.                                        |
| `EPHEMERAL_POW_SECRET`          | api (preview/PR/prod) | Proof-of-work signing secret for `POST /v1/ephemeral/provision`. Required for ephemeral publish.   |
| `STREAM_INTERNAL_SECRET`        | api, stream           | Shared secret for stream Worker calls to `api` live-update authorize.                              |
| `WORKOS_API_KEY`                | api, web, mcp         | WorkOS server-side API credential. Same target WorkOS project; `bootstrap:* --with-web` writes it. |
| `WORKOS_CLIENT_ID`              | api, web              | Also kept in Wrangler vars as non-secret deployment metadata/placeholders.                         |
| `WORKOS_COOKIE_PASSWORD`        | web                   | WorkOS AuthKit sealed-session password.                                                            |
| `WORKOS_CLI_AUDIENCE`           | api                   | WorkOS User Management audience used to verify CLI/login and dashboard session issuer details.     |

Deferred secrets not created for the current app:

- `ACCESS_LINK_SIGNING_KEY_V1` - waits for Phase 4 Access Links.
- Stripe secrets/webhook secret - wait for post-launch billing.

## Known Security / Ops Gaps

- Cloudflare Access gates the production operator web surface: `/admin` on
  `app.agent-paste.sh` and `/v1/web/admin/lockdowns` on `api.agent-paste.sh`.
  Team domain: `zaks-io.cloudflareaccess.com`. `CF_ACCESS_TEAM_DOMAIN` is
  recorded in `apps/api/wrangler.jsonc`; `CF_ACCESS_AUD` is stored as a Wrangler
  secret (not a plain var) because secret scanning treats the high-entropy
  identifier as sensitive.
- `CF_ACCESS_AUD` is set on `agent-paste-api-preview` and
  `agent-paste-api-production`. Both hosted API Workers were deployed after
  removing the old tracked plain-var binding.
- Production service-token smoke for `/v1/web/admin/lockdowns` passed on
  2026-05-26 after confirming the Access app policy used `Service Auth` and
  uploading the current app audience as the production `CF_ACCESS_AUD` secret.
- Human browser access to `/admin` passed on 2026-05-26 after assigning the
  WorkOS `admin` role slug and redeploying the role-based operator check.
- Human operator authorization now uses the WorkOS `admin` role slug in the
  session access token.
- No new CNAME is needed for the current path-based Access setup. A dedicated
  admin/operator hostname remains optional future work if the surface grows.
- Legacy `ADMIN_TOKEN` `/admin/*` routes and CLI admin verbs were removed in
  AP-13. Operator work uses WorkOS + `/v1/web/admin/*`; hosted smokes use
  `SMOKE_HARNESS_SECRET` (preview/PR) or `AGENT_PASTE_PRODUCTION_SMOKE_API_KEY`
  (production).
- Cross-workspace operator artifact/event browsing remains a future gap; see
  [`docs/ops/ap-12-migration-plan.md`](../ap-12-migration-plan.md).
- Public Agent View uses contract-declared artifact rate limits via
  `ARTIFACT_RATE_LIMIT` on `api`.

## GitHub / CI

- `TURBO_TOKEN`, `TURBO_TEAM`, `TURBO_REMOTE_CACHE_SIGNATURE_KEY`,
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
  `DATABASE_URL_MIGRATIONS_PRODUCTION` (or legacy `PRODUCTION_DATABASE_URL`),
  `NEON_API_KEY`, `NEON_PROJECT_ID`, `CLOUDFLARE_WORKERS_SUBDOMAIN`,
  `PR_PREVIEW_SECRET_SEED`, the preview smoke harness secret, and
  `AGENT_PASTE_PRODUCTION_SMOKE_API_KEY` are present or proven by successful
  workflows.
- PR preview deploys target the single GitHub Environment named `Preview` for
  secrets and variables. Runtime resources are still PR-scoped Cloudflare
  Workers, Neon branches, Hyperdrive configs, and queues.
- `NEON_PRODUCTION_BRANCH_ID` is optional safety metadata and not active.
- `NPM_TOKEN` is needed for future real CLI releases; the npm namespace is
  already reserved by `@zaks-io/agent-paste@0.0.0`.
- GitHub Production required-reviewer/wait-timer/admin-bypass posture is parked.

## Deploy Order

1. `pnpm setup:codex`
2. `pnpm verify`
3. `pnpm smoke:local`
4. Address the active backlog item, or document why it is deferred.
5. For runtime changes: `pnpm migrate:preview && pnpm deploy:preview && pnpm smoke:preview &&
pnpm smoke:preview:ephemeral`
6. After MCP-affecting deploys, run `pnpm smoke:mcp:preview` (optionally with
   `AGENT_PASTE_MCP_SMOKE_ACCESS_TOKEN` for authenticated tool checks).
7. Same-repo PRs exercise the PR preview deploy workflow automatically. The PR
   workflow gates on `/healthz` readiness, hosted ephemeral publish smoke
   (`scripts/smoke-hosted-ephemeral.mjs pr`), and local dashboard Lighthouse.
   The standard hosted MVP smoke (`pnpm smoke:pr`) remains manual when diagnosing
   a preview.
8. Production deploy only with explicit Isaac approval:
   `pnpm migrate:production && pnpm deploy:production && pnpm smoke:production &&
pnpm smoke:production:ephemeral && pnpm smoke:mcp:production`. The production
   GitHub deploy workflow runs the unauthenticated MCP smoke automatically;
   authenticated MCP tool checks stay manual via `AGENT_PASTE_MCP_SMOKE_ACCESS_TOKEN`.

## Hosted ephemeral publish smoke

Operator playbook (support, abuse, Claim Token cases):
[`runbook-ephemeral-publish.md`](../runbook-ephemeral-publish.md).

`scripts/smoke-hosted-ephemeral.mjs` proves the deployed ephemeral chain end to end:
proof-of-work provision, CLI `publish --ephemeral`, content and Agent View fetches,
script-disabled CSP, `noindex`, and optional claim redemption.

| Command                           | When to run                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm smoke:preview:ephemeral`    | After shared preview deploy when `EPHEMERAL_POW_SECRET` is set on the preview API Worker.             |
| `pnpm smoke:pr:ephemeral`         | Automatically in `.github/workflows/pr-preview.yml` after PR Workers are ready.                       |
| `pnpm smoke:production:ephemeral` | Operator-only after production deploy; uses the tiny `examples/local-harness/ephemeral-site` fixture. |

Secrets and skip behavior:

- **Required on API Worker:** `EPHEMERAL_POW_SECRET` (bootstrap via `scripts/bootstrap-secrets.mjs`, or PR preview seed via `PR_PREVIEW_SECRET_SEED`). When missing, the smoke exits **0** with a clear skip message (not a false pass).
- **Preview/PR cleanup:** `AGENT_PASTE_*_SMOKE_HARNESS_SECRET` deletes the published artifact through `__test__/delete-artifact` (no legacy admin token).
- **Optional claim check:** `AGENT_PASTE_EPHEMERAL_SMOKE_WORKOS_ACCESS_TOKEN` (member WorkOS access token). When unset, publish/policy assertions still run; claim redemption is reported as skipped.
- **Explicit skip:** `AGENT_PASTE_SKIP_EPHEMERAL_SMOKE=1`.

Smoke output redacts the Claim Token hash in the summary line and never logs API keys or signed URL secrets.

## Database credential boundaries

- Migrations use `platform_admin` via `DATABASE_URL_MIGRATIONS_*` in GitHub
  Actions only. See [`runbook-neon-database-roles.md`](../runbook-neon-database-roles.md).
- Hyperdrive configs for `api` and `upload` must use `app_role`
  (`DATABASE_URL_RUNTIME_*`). PR previews resolve separate Neon URLs for migrate vs
  Hyperdrive in `.github/workflows/pr-preview.yml`.
- After merging role migrations, update production/preview Hyperdrive configs and
  rotate GitHub secrets off legacy `PRODUCTION_DATABASE_URL` when ready.

## Open Ops Items

- Decide whether to add a dedicated admin/operator hostname; no CNAME is needed
  for the current path-based Access gate.
- Update hosted Hyperdrive configs to `app_role` URLs and store
  `DATABASE_URL_MIGRATIONS_PRODUCTION` in GitHub Production (operator action).
- Wire Logpush -> Axiom when Isaac is ready for Cloudflare/Axiom click-ops.
- Revisit GitHub Production environment reviewer/wait-timer/admin-bypass posture.
