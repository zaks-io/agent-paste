# Hosted Ops

Last updated: 2026-06-15.

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

`scripts/bootstrap-secrets.mjs` generates first-deploy MVP secrets and optional web
secrets. Use `--with-web` only when all WorkOS inputs are available. Steady-state
secret application is otherwise handled by `scripts/deploy.mjs <preview|production>`
(ADR 0078): it binds every secret to its consumer Workers (generate-if-missing, or
from `PRODUCTION_*`/`PREVIEW_*` env values) on each deploy, so they stay in sync.
Rotation goes through `scripts/rotate-versioned-secret.mjs` /
`scripts/rotate-workos-secrets.mjs`.

| Secret                          | Bound on                   | Notes                                                                                                                                     |
| ------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `CONTENT_SIGNING_SECRET`        | api, upload, content       | Active content-token and Agent View signing secret.                                                                                       |
| `UPLOAD_SIGNING_SECRET`         | upload                     | Active upload PUT token signing secret.                                                                                                   |
| `ARTIFACT_BYTES_ENCRYPTION_KEY` | api, upload, content, jobs | Root key for per-workspace artifact-byte AES-256-GCM (ADR 0063). Same value on all four Workers. Claim reparent re-encrypts blobs on api. |
| `API_KEY_PEPPER_V1`             | api, upload                | Active API-key HMAC pepper.                                                                                                               |
| `SMOKE_HARNESS_SECRET`          | api (preview/PR)           | Non-production smoke harness only; never set on production.                                                                               |
| `EPHEMERAL_POW_SECRET`          | api (preview/PR/prod)      | Proof-of-work signing secret for `POST /v1/ephemeral/provision`. Required for ephemeral publish.                                          |
| `STREAM_INTERNAL_SECRET`        | api, stream                | Shared secret for stream Worker calls to `api` live-update authorize.                                                                     |
| `WORKOS_API_KEY`                | api, web, mcp              | WorkOS server-side API credential. Same target WorkOS project; `bootstrap:* --with-web` writes it.                                        |
| `WORKOS_CLIENT_ID`              | api, web                   | Also kept in Wrangler vars as non-secret deployment metadata/placeholders.                                                                |
| `WORKOS_COOKIE_PASSWORD`        | web                        | WorkOS AuthKit sealed-session password.                                                                                                   |
| `WORKOS_CLI_AUDIENCE`           | api                        | WorkOS User Management audience used to verify CLI/login and dashboard session issuer details.                                            |

Launch-readiness secret notes:

- `SMOKE_HARNESS_SECRET` must exist only on preview/PR workers. It was found on
  `agent-paste-api-production` after the production smoke-path hardening and
  blocked deploys through `6ad04f5`; Isaac deleted it on 2026-06-07 with
  `wrangler secret delete SMOKE_HARNESS_SECRET --name agent-paste-api-production`.
  Manual `Deploy Production` run `27101054536` then deployed `6ad04f5`
  successfully and passed the read-only production smoke.
- Stripe secrets are optional and route-gated by `BILLING_ENABLED`. Hosted
  Stripe test-mode was verified in preview by Isaac on 2026-06-07. If billing
  is enabled for paid public launch, run a final production Stripe smoke after
  deploy.

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

- AP-236 shipped in PR #356. `.github/workflows/deploy-production.yml` no
  longer exposes job-wide Turbo/Cloudflare deploy secrets, validates that
  `workflow_run` deploys come from a successful `main` run in this repository,
  checks out `refs/heads/main`, and refuses to deploy if the checked-out SHA
  differs from the CI head SHA.
- `CI` and `Security` are green on current `main` (`6ad04f5`). Production
  deploys after `5411f0f` failed because production still carried forbidden
  `SMOKE_HARNESS_SECRET` on the API Worker. Isaac deleted that secret on
  2026-06-07; manual `Deploy Production` run `27101054536` then succeeded on
  `6ad04f5` with migration, Worker deploy, and read-only production smoke green.
- `TURBO_TOKEN`, `TURBO_TEAM`, `TURBO_REMOTE_CACHE_SIGNATURE_KEY`,
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
  `DATABASE_URL_MIGRATIONS_PRODUCTION` (or legacy `PRODUCTION_DATABASE_URL`),
  `NEON_API_KEY`, `NEON_PROJECT_ID`, `CLOUDFLARE_WORKERS_SUBDOMAIN`,
  `PR_PREVIEW_SECRET_SEED`, the preview smoke harness secret, and
  `AGENT_PASTE_PRODUCTION_SMOKE_API_KEY` are present or proven by successful
  workflows.
- Default PR CI uses a job-local Postgres service container through
  `pnpm smoke:ci:postgres`; it migrates once, runs the local CLI smoke through
  `app_role`, and does not create Neon branches or Hyperdrive configs.
- PR preview deploys target the single GitHub Environment named `Preview` for
  secrets and variables when the PR carries the `full-pr-preview` label. Runtime
  resources are still PR-scoped Cloudflare Workers, Neon branches, Hyperdrive
  configs, and queues.
- `NEON_PRODUCTION_BRANCH_ID` is optional safety metadata and not active.
- `NPM_TOKEN` is needed for future real CLI releases; the npm namespace is
  already reserved by `@zaks-io/agent-paste@0.0.0`.
- npm trusted publishing (OIDC) is configured for `@zaks-io/agent-paste`
  (operator-confirmed 2026-06-07). Prefer the trusted-publishing path over a
  long-lived npm token for real releases.
- GitHub Production required-reviewer/wait-timer/admin-bypass posture is parked.

## Launch Readiness Decisions

- Public incident intake minimum bar is `support@agent-paste.sh`, which routes to
  email and then into Linear. A separate hosted status page remains optional
  until the account/tooling stack is ready.
- Hosted Stripe test-mode verification passed in preview. Production Stripe is
  not yet smoke-tested; run it only if billing is enabled for paid public launch.
- Public-launch account gates done 2026-06-08: repo is public, apex GitHub
  source link resolves, and GitHub CodeQL/code scanning, secret scanning + push
  protection, Dependabot alerts, and OpenSSF Scorecard are all enabled.

## Deploy Order

1. `pnpm setup:codex`
2. `pnpm verify`
3. `pnpm smoke:local`
4. Address the active backlog item, or document why it is deferred.
5. For runtime changes: `pnpm migrate:preview && pnpm deploy:preview && pnpm smoke:preview &&
pnpm smoke:preview:ephemeral`
6. After MCP-affecting deploys, run `pnpm smoke:mcp:preview` (optionally with
   `AGENT_PASTE_MCP_SMOKE_ACCESS_TOKEN` for authenticated tool checks).
7. Same-repo PRs exercise job-local Postgres smoke in CI automatically. Add the
   `full-pr-preview` label only when a PR requires deployed Cloudflare Worker
   evidence; that workflow gates on `/healthz` readiness, hosted ephemeral
   publish smoke (`scripts/smoke-hosted-ephemeral.mjs pr`), and local dashboard
   Lighthouse. The standard hosted MVP smoke (`pnpm smoke:pr`) remains manual
   when diagnosing a preview.
8. Production deploy only with explicit Isaac approval:
   `pnpm migrate:production && pnpm deploy:production && pnpm smoke:production &&
pnpm smoke:production:ephemeral && pnpm smoke:mcp:production`. The production
   GitHub deploy workflow runs the unauthenticated MCP smoke automatically;
   authenticated MCP tool checks stay manual via `AGENT_PASTE_MCP_SMOKE_ACCESS_TOKEN`.

## Hosted ephemeral publish smoke

Operator playbook (support, abuse, Claim Token cases):
[`runbook-ephemeral-publish.md`](../runbook-ephemeral-publish.md).

`scripts/smoke-hosted-ephemeral.mjs` proves the deployed ephemeral chain end to end:
provision, CLI `publish --ephemeral`, content and Agent View fetches,
script-disabled CSP, `noindex`, and optional claim redemption.

| Command                           | When to run                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm smoke:preview:ephemeral`    | After shared preview deploy when `EPHEMERAL_POW_SECRET` is set on the preview API Worker.             |
| `pnpm smoke:pr:ephemeral`         | Automatically in `.github/workflows/pr-preview.yml` after PR Workers are ready.                       |
| `pnpm smoke:production:ephemeral` | Operator-only after production deploy; uses the tiny `examples/local-harness/ephemeral-site` fixture. |

Secrets and skip behavior:

- **Required on API Worker:** `EPHEMERAL_POW_SECRET` (bootstrap via `scripts/bootstrap-secrets.mjs`, or PR preview seed via `PR_PREVIEW_SECRET_SEED`). When missing, the smoke exits **0** with a clear skip message (not a false pass).
- **Probe failures:** network errors, 5xx responses, and unexpected provision
  error codes fail the smoke. Only the explicit skip flag or
  `database_unavailable` from a missing `EPHEMERAL_POW_SECRET` skip cleanly.
- **Required Wrangler binding:** `EPHEMERAL_PROVISION_GATE` Durable Object. When
  missing or unhealthy, provision fails closed with
  `ephemeral_provision_unavailable`.
- **Preview/PR cleanup:** `AGENT_PASTE_*_SMOKE_HARNESS_SECRET` deletes the published artifact through `__test__/delete-artifact` (no legacy admin token).
- **Optional claim check:** `AGENT_PASTE_EPHEMERAL_SMOKE_WORKOS_ACCESS_TOKEN` (member WorkOS access token). When unset, publish/policy assertions still run; claim redemption is reported as skipped.
- **Explicit skip:** `AGENT_PASTE_SKIP_EPHEMERAL_SMOKE=1`.

Smoke output redacts the Claim Token hash in the summary line and never logs API keys or signed URL secrets.

## Production agent ergonomics smoke

2026-06-15 AP-139 partial pass against production:

- Public docs fetched from `https://agent-paste.sh/agents.md`,
  `https://agent-paste.sh/llms.txt`, `https://agent-paste.sh/llms-full.txt`, and
  `https://agent-paste.sh/docs/cli.md`. The deployed docs match npm
  `@zaks-io/agent-paste@0.1.7`: unlisted sharing is
  `set-visibility <artifact-id> unlisted` / MCP `set_visibility`, not
  `make-public`.
- MCP unauthenticated entrypoints verified: `GET https://mcp.agent-paste.sh`
  returns endpoint metadata, `/.well-known/oauth-protected-resource` returns the
  WorkOS resource metadata, and unauthenticated JSON-RPC `POST /` returns `401`
  with `WWW-Authenticate`.
- Authenticated CLI path verified with `npx -y @zaks-io/agent-paste@latest`:
  `version`, `whoami --json`, private `publish --json`, Agent View fetch,
  signed file fetch, `set-visibility unlisted --json`, access-link resolve,
  `set-visibility private --json` revocation, `publish --artifact-id --json`,
  `pull --json`, `edit --json`, and `publish --ephemeral --json`.
- Ephemeral safety checks passed: `--ephemeral` warned that stored login is
  ignored, returned a claim link with 24 hour expiry, Agent View did not contain
  the Claim Token, content served with `script-src 'none'`, and content carried
  `X-Robots-Tag: noindex, nofollow`.
- Production bug found: every fresh Bundle generated during the smoke
  transitioned from `pending` to `failed`, and Axiom showed
  `queue.bundle_generate.failed` plus `queue.safety_scan.failed` on
  `agent-paste-jobs-production` with Cloudflare `Illegal invocation: function
called with incorrect this reference`. Example failed revisions:
  `rev_B90MHRGD0R7VJ14TVMYCA6J4Y0` and
  `rev_SVB214MNQJ7Z6KW82DPXPGE9QZ`. Root cause: jobs code detached R2 binding
  methods (`ARTIFACTS.get` / `ARTIFACTS.put`) before calling them. Fixed in
  production by deploy run `27579713918` for `49c531ec`; fresh smoke bundles
  reached `ready` for `rev_KGJGR62R1DNMW78A7W3JH9REJ4`,
  `rev_G5NHTHPCGGWA7PTWY97XBYPYH4`, and
  `rev_G13QE0HKHVTR0VGKVMBJ6V10DS`.
- CLI ergonomics bug found and fixed in source:
  `publish --artifact-id` without `--title` renamed the Artifact to the local
  temp directory basename. Fixed in npm `@zaks-io/agent-paste@0.1.8`
  (`3bc1d56`): production smoke verified `npx @latest publish --artifact-id`
  without `--title` preserves the existing Agent View title, `pull` read back
  the revised content, and the smoke Artifact was deleted.
- Public CLI docs gap found and fixed in `0.1.8`: `/docs/cli.md` now documents
  the real `pull` and `edit` commands that agents need for read-back and literal
  edits.
- Follow-up authenticated MCP pass completed through `mcporter` after WorkOS
  OAuth. Verified live production tools: `whoami`, `publish_artifact`,
  `list_artifacts`, `read_artifact`, `read_file`, `add_revision`, `multi_edit`,
  `list_revisions`, `set_visibility unlisted`, `list_access_links`,
  `create_revision_link`, `revoke_access_link`, `set_visibility private`, and
  `delete_artifact`. Smoke Artifacts created in the authenticated Workspace were
  deleted after the pass; the ephemeral Artifact remains in its temporary
  Workspace and expires automatically.
- MCP ergonomics gaps found in the authenticated pass: live tool descriptions
  incorrectly said to keep `artifact_id` from `publish_artifact` responses even
  though publish outputs intentionally omit IDs, and the ID field names differ by
  list tool (`list_artifacts.data[].id`, `list_revisions.items[].revision_id`,
  `list_access_links.items[].id`). Source docs/tool text now describe the actual
  shapes; deploy before the next fresh-session pass.

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
- Native Workers Observability -> Axiom is live. The older per-Worker Logpush
  design is superseded and kept only as a reference if dedicated datasets are
  needed later.
- Revisit GitHub Production environment reviewer/wait-timer/admin-bypass posture
  after launch/users. Do not add hard production deploy limits as part of
  AP-236.
