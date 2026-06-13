# Changelog

Newest first. This is an operator-facing changelog for implemented project work;
use `git log` for commit-level detail.

## 2026-06-08

### Public repository flip + GitHub security posture (AP-254)

The repo is now **public** (`github.com/zaks-io/agent-paste`). The public-repo
security toggles tracked under AP-254 are live and verified against the GitHub
API:

- **OpenSSF Scorecard** — `.github/workflows/scorecard.yml` (`3d64126`, #444)
  scores supply-chain posture on `main` push, weekly cron, and
  `branch_protection_rule`, publishing to the public OpenSSF API; the README
  badge (`2de2280`, #447) resolves.
- **CodeQL code scanning** — enabled via GitHub default setup (SARIF visible in
  the code-scanning tab; no committed `codeql.yml`).
- **Secret scanning + push protection** — enabled.
- **Dependabot alerts** — enabled. Version **updates** stay off by design;
  dependency bumps come through the scheduled review agent, not Dependabot PRs.
- **SHA-pinned Actions** — every external action across all workflows pinned to
  a commit SHA (`33474e4`, #436) with the `sha_pinning_required` repo policy on.
- **Pre-flip cleanup** — internal-only docs and a dead operator email dropped
  before going public (`0e1eadd`, #437); NOTICE copyright updated (`92f6287`,
  #435).

Remaining AP-254 items are advisory-only refinements (route Trivy/Semgrep SARIF
through `codeql-action/upload-sarif`; promote scanners advisory→gating) tracked
in [security-todo.md](../security-todo.md).

### CLI release plumbing fixes

A run of CLI-release and CI hardening landed after the 2026-06-07 deploy:
Windows entrypoint/stdout fixes, bun standalone-binary detection, npm
release-publish hardening (#440), version-bake fix, release-asset restriction,
PR-preview Neon branch idempotency (#439), and the AP-219 pre-push time-bomb
fix (#438). See `git log` for the full list.

## 2026-06-07

### Early-alpha production operator updates

- Captured operator decisions that npm trusted publishing is configured, hosted
  Stripe test-mode verification passed in preview, and public incident intake
  will use `support@agent-paste.sh`, routed through email into Linear. A separate
  hosted status page remains optional until the account/tooling stack is ready.
- Removed the stale production `SMOKE_HARNESS_SECRET` blocker from
  `agent-paste-api-production` (operator action by Isaac). Production deploys
  after `5411f0f` had failed through current `main` (`6ad04f5`) until that
  secret was deleted.
- Manually triggered `Deploy Production` after the secret cleanup; run
  `27101054536` deployed `6ad04f5` successfully, including migration, Worker
  deploy, and read-only production smoke.
- Reconciled status docs with completed AP-109/AP-174/AP-181/AP-242 work.

## 2026-06-05

### Legal contact + secrets guidance for launch credibility (PR #393, AP-254)

An external credibility review ("credible early-alpha vendor, not mature vendor yet")
flagged two doc gaps; both are now closed on the apex marketing site:

- **Registered address on legal pages:** Terms and Privacy publish the
  `Zaks.io, LLC` registered mailing address (`2108 N St, Ste N, Sacramento, CA
95816, USA`), and Privacy gained a Contact section it was missing.
- **"What not to publish" safety guidance:** the safety docs page now leads with
  a user-facing warning not to upload secrets, credentials, `.env` files, or
  other people's data into published Artifacts.

The review's deeper asks (release provenance, npm metadata/provenance) were
verified already shipped (AP-148, AP-154; `npm publish --provenance`), so no
work was duplicated. Remaining public-repo/security posture toggles (apex GitHub
source-link flip, GitHub security features, npm OIDC, status page) are tracked
in [AP-254](https://linear.app/zaks-io/issue/AP-254).

### Post-launch hardening wave: correctness + security fixes

A cluster of focused fixes closed gaps surfaced by review on the now
feature-complete surface (most delegated to Cursor):

- **Access Link denylist completeness (AP-186, #292):** access-link revoke and
  member lockdown now write the KV denylist keys (`ald:`/`ad:`) post-commit, so
  already-minted content URLs stop resolving instead of staying valid until
  token expiry. Lift re-derives retention before deleting the shared
  `ad:{artifactId}` key, and revoke/lockdown fail closed with
  `storage_unavailable` (503) when the KV write fails after retries. ADR 0057
  updated to document the fail-closed retry instead of a phantom cron sweep.
- **Upload finalize guard (AP-187, #295):** `finalizeUploadSession` inspects
  status and `expires_at` before inserting revisions — idempotent replay for
  already-finalized sessions, `upload_session_expired` for expired ones.
- **Jobs RLS scoping (#296):** safety-scan / bundle-generate queue consumers and
  malicious-URL lockdown now run inside `withWorkspaceScope` / `withPlatformScope`
  so they satisfy FORCE RLS under `app_role`, matching the cron handlers.
- **Auth L1 cache bound (#289):** the module-scope token cache now LRU-evicts at
  1000 entries per ADR 0062, so an invalid-token flood can't grow it unbounded.
- **Upload malformed-escape handling (AP-190, #293):** a malformed percent-escape
  in the signed PUT path now returns 401 (not 500) by falling through to
  `not_authenticated`.
- **MCP idempotency key overflow (#290):** a max-length client idempotency key no
  longer overflows `IdempotencyKey.max` when the optional `:share-link` suffix is
  appended; long keys are hashed via fnv1a32 first.
- **CLI fixes:** config dir is created `0700` even when update-check runs before
  login (AP-192, #291); a stale keyring entry is cleared when `setPassword`
  falls back to the file store so `load()` can't return an older credential
  (AP-194, #298).
- **Web OAuth deep-link (#294):** the WorkOS callback honors the validated
  `returnPathname` from OAuth state instead of always redirecting to
  `/dashboard`.

### Standardized security headers + strict nonce CSP on public surfaces (AP-184)

- Applied one shared baseline of HTTP security headers (HSTS, nosniff,
  X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP) across all eight
  Workers via `packages/worker-runtime/src/security-headers.ts`, preserving each
  Worker's existing stricter CSP/cache-control (#271). The two public HTML
  surfaces — dashboard and apex — went strict-CSP with per-request nonces and no
  script `'unsafe-inline'`; browser-verified on preview with zero violations.
  The dashboard nonce threads to TanStack via an AsyncLocalStorage bridge; the
  CF Analytics beacon is declared through `head().scripts` so the nonce sticks.
  Follow-up: drop style `'unsafe-inline'` (the one open item in
  [`web-csp-todo.md`](../web-csp-todo.md)).
- Reconciled `content-rendering.md` with the content Worker's emitted HSTS and
  X-Frame-Options headers (AP-193, #288).

### Billing seam cleanup (AP-183)

- Localized architecture cleanup of the billing system with no behavior change
  (#269): the write-allowance tier resolver now takes an honest `claimed:
boolean` instead of a fabricated workspace id; the five member-facing billing
  handlers share a pre-RLS-scoped `resolveBillingMemberCtx`; and a new
  `@agent-paste/plans` package owns the presentational half of a Plan, sourcing
  the allowance bullet from the enforced config constants instead of re-typing
  the number as prose.

### Scope decisions: malware scanner cancelled, WATCH deferred, no public SDK

- Cancelled the file-bytes hash-reputation malware scanner (AP-149): too
  expensive to operate for the value at this stage. Not wiring the
  MalwareBazaar/VirusTotal provider integration. Existing containment
  (script-disabled ephemeral serving, locked CSP on the Content Origin, 24h
  auto-deletion + noindex) already bounds the distribution risk; the
  built-in text warnings, Llama Guard, and URL Scanner stay in place.
- Deferred the CLI `watch` auto-republish command (AP-167) to Backlog: an agent
  can publish repeatedly; no current need for auto-republish-on-change.
- Decided against a public SDK (ADR 0017 was already "no SDK in the MVP"). The
  CLI (npm + standalone signed binaries) and the documented REST surface are the
  supported client surfaces; ADR 0017 moved to Done.

### Doc correction: Worker observability is live in Axiom (ADR 0011)

- Corrected the docs that called Logpush -> Axiom "parked." All Workers (preview,
  production, and PR previews) already emit OTel traces to the Axiom `cloudflare`
  dataset via native Workers Observability (`observability.enabled`), carrying
  response status, wall/CPU time, route, `outcome`, and structured app-level
  events — verified live (~22.7k traces/24h across api/upload/content/web/apex/
  mcp/jobs/stream). ADR 0011 moved to Done in `coverage.md`. The six-job
  per-Worker Logpush design in `runbook-logpush.md` is superseded (not pursued);
  the runbook is marked as such and kept only as a reference for dedicated
  per-Worker datasets/retention if ever wanted.

### Stripe billing end-to-end: Checkout/webhooks/Portal + dashboard

- Landed the Stripe billing API surface (AP-5, #253): synchronous Checkout
  activation, signature-verified idempotent webhooks, Customer Portal redirect,
  billing status read, and operator plan override. Stripe is a sync layer over
  local entitlement; enforcement reads only `workspaces.plan`. Routes mount and
  Stripe is imported only when `BILLING_ENABLED` is set (off by default).
- Shipped the web billing dashboard at `/settings/billing` (AP-176, #266): plan,
  subscription status, live daily write allowance + remaining, renewal date,
  upgrade/manage actions wired to the real Checkout/Portal endpoints, and a real
  Stripe invoice table. Billing-off renders a friendly "not enabled" state and
  never calls Stripe. Two small read-only API additions back the page:
  `GET /v1/web/billing` now returns `daily_new_artifact_allowance` and
  `daily_new_artifacts_remaining` (omitted when the counter is unavailable,
  never faked), and new `GET /v1/web/billing/invoices` is backed by a
  `listInvoices` provider method (Stripe/noop/fake adapters). Pro displays as
  $12/mo and $120/yr app-side; Stripe stays the source of truth at checkout.
- With this, the full Free + Pro billing path (AP-4/AP-5/AP-6/AP-176) is
  implemented behind the deploy-time flag. Remaining billing work: hosted Stripe
  test-mode verification (needs credentials + approval) and the ephemeral
  claim/upgrade funnel (AP-109).

### Write-allowance fail-closed + ephemeral anti-abuse assessment

- Made the write-allowance binding fail closed: a missing or unreachable
  new-Artifact allowance counter now returns 503 (`storage_unavailable`) instead
  of silently admitting the publish (AP-170, #243).
- Assessed ephemeral proof-of-work as the anti-abuse lever (AP-169 spike,
  [`ap-169-pow-difficulty-assessment.md`](../ap-169-pow-difficulty-assessment.md)):
  PoW at difficulty 20 is a speed bump (one GPU ≈ 0.2 ms/solve), the honest JS
  agent path is ~12 s not "a few hundred ms," and the "global" provision cap is
  per-PoP eventually consistent. Recommendation: keep PoW, do not migrate to
  memory-hard hashing, and move the lever to a strongly-consistent global
  provision counter (DO, AP-173) plus runtime-tunable caps (AP-174).

## 2026-06-04

### Dashboard Access Link management + live dashboard

- Shipped member `/v1/web/*` Access Link routes and the dashboard management UI:
  list/create/mint/revoke/lockdown on `/access-links` and the artifact detail
  route (AP-156, #213/#220). Mint and revoke are `idempotency:none` by contract
  (AP-163, #230) — the fix landed in the contract, not the handler.
- Moved the dashboard to a TanStack Query client cache with an SSE-driven live
  UI so published/revoked changes reflect without reload (AP-164, #229).

### Ephemeral TTL + claim hardening

- Made artifact TTL a purely server-side policy decision with no client input
  (AP-161) and healed a stale null `claimed_at` on returning web-member login
  (AP-162, #225).

### MCP write-path + OAuth scope fixes

- Derived MCP OAuth scopes from the member role and unblocked AuthKit login per
  ADR 0079 (AP-153, #205).
- Wired MCP write-path secrets (`WORKOS_API_KEY`, `ACCESS_LINK_SIGNING_KEY`)
  into deploy routing (AP-159, #216).

### CLI distribution: standalone signed binaries + self-upgrade (ADR 0080)

- `cli-release.yml` cross-compiles the CLI into standalone binaries for four
  targets (linux-x64/arm64, macos-arm64, windows-x64) via `bun build --compile`,
  codesigns + notarizes the macOS binary, and attaches them to a draft GitHub
  release alongside the npm publish (AP-36/AP-41). Version is baked into each
  binary and the release tag derives from `package.json` (#232, #244, #254); the
  keychain backend was fixed so the standalone binary runs (AP-147, #197).
  `agent-paste upgrade` downloads + verifies + self-replaces a binary install.
  Runbook: [`runbook-cli-release.md`](../runbook-cli-release.md).

### CLI release supply-chain (AP-154 Phase 1)

- The CLI release workflow now captures an SBOM, provenance, and scan-result
  metadata, and adds a supply-chain scan gate (AP-154 Phase 1, #226).

### CI + smoke maintenance

- Ran `scripts/` unit tests in the `Validate` gate (AP-145, #219), raised the
  web test timeout to de-flake cold-cache runs (AP-140, #221), de-flaked the
  ephemeral PoW "rejects invalid solutions" counter race (AP-150, #222), and
  retried transient Cloudflare 10013s on PR-preview queue create (AP-157, #212).
- Dropped the artifact rate-limit smoke probe (AP-143, #211): Cloudflare's
  `ratelimits` binding is permissive and per-edge by design, so the 80-request
  probe could not be expected to trip it; the `429 rate_limited_artifact`
  envelope stays proven by `apps/content` unit tests.

### Ops decisions closed

- Closed AP-138: production deploys run the credential-free
  `pnpm smoke:prod:readonly` canary instead of the removed authed smoke; the
  authed CI-vs-local 401 divergence is not chased.
- Recorded the dedicated operator-hostname decision (AP-11, no new CNAME) and
  reviewed the GitHub Production environment reviewer/wait-timer posture (AP-17).

### Dedicated security workflow (ADR 0076)

- Added `.github/workflows/security.yml`, the private-phase security gate from
  ADR 0076. Jobs: full-history gitleaks secret scan (gating), Snyk Open Source
  (gating, org-wide `SNYK_TOKEN`), advisory Snyk Code, Trivy filesystem, Grype,
  and Semgrep scans, and a Syft SPDX SBOM uploaded as a 90-day artifact.
  `snyk monitor` reports `main` on push. (Snyk Code is advisory pending org SAST
  entitlement + triage of its initial findings — see AP-160.)
- Split secret scanning: `ci.yml`'s `Secret scan` is now a fast incremental
  PR-range gitleaks scan; the full-history scan runs in `security.yml` on push to
  `main`, a daily 09:00 UTC cron, and manual dispatch.
- Advisory scanner SARIF is uploaded as plain build artifacts, not to GitHub code
  scanning. CodeQL/Scorecard/Dependabot, SARIF-to-code-scanning, gating promotion
  of the advisory scanners, npm OIDC publishing, and public badges stay deferred
  to the public phase (tracked in `docs/ops/security-todo.md`).

### Open-core license landed: Apache-2.0

- Adopted Apache-2.0 for the repo. Added root `LICENSE` + `NOTICE`, `SECURITY.md`
  (private reporting, no bounty), and `license: "Apache-2.0"` on every package
  (CLI flipped from `UNLICENSED`).
- CLI publish guard now passes the license gate and remains as a regression
  guard; `LICENSE` is bundled into the published package.
- Re-verified gitleaks over full history (1298 commits across all refs, clean).
- Remaining go-public steps are GitHub-side per ADR 0076 (visibility flip,
  CodeQL/secret scanning/Dependabot/Scorecard, npm OIDC publishing).

## 2026-06-02

### Ephemeral publish operator runbook (AP-112)

- Added `docs/ops/runbook-ephemeral-publish.md` for provision/publish/claim flow,
  abuse and lockdown response, Claim Token support guidance, and smoke verification.
- Reconciled status ledgers with AP-107/108/110/111 completion on `main`.

### Ephemeral publish foundation and moderation (AP-99/AP-101/AP-104)

- Added Ephemeral Workspace state, `claim_tokens`, RLS coverage, claim-token
  hashing, and repository workflow support.
- Added `POST /v1/ephemeral/provision` with proof-of-work challenge/solution
  handling, dedicated rate-limit bindings, and returned API Key + Claim Token.
- Added the 24h ephemeral auto-deletion cap, noindex/nofollow token signal,
  noindex headers/meta injection, and ephemeral-tier scanner routing with URL
  Scanner/Platform Lockdown integration.

### Platform and repo modularization catch-up

- Split API route families, DB repository workflows/entities, web command
  palette modules, contracts route/MCP registries, and shared WorkOS/MCP auth
  primitives into focused modules.
- Added `packages/billing` with plan helpers, `BillingProvider` adapters,
  synchronization/reconciliation, drift logging, and `workspace_billing`.
- Added app-layer Artifact bytes encryption helpers and Worker key-ring support.
- Added ADR 0076 for public security badge posture and kept npm publish blocked
  while the CLI remains `UNLICENSED`.
- Restored AP-91 route coverage and added stale PR-preview cleanup tooling.
- Synced repo workflow skills, added `workflow-decompose`, and excluded vendored
  `.agents` skills from Biome formatting.

### Agent skills migrated to the `ziw-*` family

- Replaced the `workflow-*` agent-skill family with the synced `ziw-*` family
  and removed the 10 `workflow-*` skill directories, symlinks, and lock entries.
- Dropped `workflow-agent-queue` (its queue/status-mutation authority now lives
  in `ziw-orchestrate`) and `workflow-secret-redaction` (no replacement).
- Repointed `CLAUDE.md`, `docs/agents/workflow/config.md`, and the other agent
  docs at the `ziw-*` names; the "Agent Queue" role is now "Agent Orchestrate".

## 2026-05-28

### Stronger audit semantics and operator abuse workflows (AP-34)

- Added tenant-safe Change Summary formatting with sensitive-field redaction and
  action-specific summaries for security-relevant lifecycle events.
- Platform lockdown audit events now attribute to the affected workspace and
  record request IDs from operator API calls.
- Extended operator security-event filters and added `/admin` abuse triage
  guidance, suggested reason codes, change-summary columns, and lockdown prefill
  from platform events.

## 2026-05-27

### CLI credential hardening (AP-77)

- Added native OS keyring storage for CLI login credentials with a warned `0600`
  file fallback.
- Added API key `expires_at`, 90-day expiry for CLI-minted keys, and current-key
  self-revoke for `agent-paste logout`.
- Updated dashboard key state display to distinguish Active, Expired, and
  Revoked keys.

### Pinning and revision retention (AP-24)

- Added `artifacts.pinned_at` and dashboard `POST /v1/web/artifacts/{id}/pin|unpin`
  with a 50-artifact workspace cap; pinned rows are exempt from auto-deletion.
- Added `workspaces.revision_retention_days`; jobs retention cron marks older
  non-current published revisions `retained`, writes `rd:` denylist keys, and
  enqueues revision-scoped byte purge.
- Migration `0013_pinning_and_revision_retention.sql`.

### Jobs lifecycle byte purge ownership (AP-22)

- Moved auto-deletion expiry, denylist writes, and byte-purge enqueue from the
  API Worker scheduled cleanup path into `apps/jobs` cron discovery.
- Added purge recovery for deleted/expired artifacts missing
  `bytes_purge_enqueued_at`, plus jobs smoke harness routes for cleanup and
  purge recovery.
- Removed the API cron trigger and `POST /__test__/run-cleanup`; local/hosted
  smokes now call the jobs worker.

## 2026-05-26

### Neon database credential boundaries (AP-18)

- Added migration `0010_db_roles.sql` creating `app_role` (`NOBYPASSRLS`) and
  `platform_admin` (`BYPASSRLS`) with grants.
- Migration workflows use `DATABASE_URL_MIGRATIONS_*`; PR previews resolve
  separate Neon URLs for migrate (`platform_admin`) and Hyperdrive (`app_role`).
- Documented operator cutover in `docs/ops/runbook-neon-database-roles.md`.

### Operator event and audit browsing (AP-16)

- Added `GET /v1/web/admin/events` for WorkOS operators with pagination and
  filters (`focus`, workspace, actor type, action, target type, request id).
- Extended the `/admin` dashboard with a cross-workspace platform events table.
- Workspace member audit at `/v1/web/audit` remains tenant-scoped.
- Restored the branch coverage gate after merge with focused operator panel and
  query adapter tests; `pnpm test:coverage` reports 80.7% branch coverage.

### AP-13: retire legacy ADMIN_TOKEN admin path

- Removed `/admin/*` contract routes, API handlers, CLI `admin` verbs, and
  `ADMIN_TOKEN`/`ADMIN_TOKEN_HASH` bootstrap secrets.
- Added `SMOKE_HARNESS_SECRET` and non-production `__test__/*` smoke helpers;
  production hosted smoke uses `AGENT_PASTE_PRODUCTION_SMOKE_API_KEY`.

### Production operator access smoke

- Verified Cloudflare Access service-token auth against production
  `/v1/web/admin/lockdowns`.
- Switched human operator eligibility to the WorkOS `admin` role slug and
  verified browser access to `https://app.agent-paste.sh/admin`.
- AP-12 migration plan executed; legacy admin path fully retired.

### MCP auth decision

- Re-decided MCP OAuth on WorkOS AuthKit/Connect before implementation.
- ADR 0061 now uses CIMD as the primary MCP client self-identification path and
  keeps DCR enabled for compatibility with older MCP clients.

### npm package namespace

- Created the npm org scope `@zaks-io` and reserved the public CLI package name
  `@zaks-io/agent-paste` with placeholder version `0.0.0`.
- The package name is scoped, but the installed command remains `agent-paste`.

## 2026-05-25

### Open-core billing decisions

- Added ADR 0073 for `free`/`pro` Plan tiers behind a billing flag that is off by
  default.
- Added ADR 0074 for Stripe as a sync layer over local entitlement state.
- No billing code is implemented yet; `packages/billing`, `workspaces.plan`,
  `workspace_billing`, Stripe routes, webhooks, Portal, and jobs reconciliation
  remain future work.

### Repo/docs guardrails and coverage

- Recent `main` includes docs and monorepo guardrail work through
  `b7927d5 docs: competitor analysis and open-core billing ADRs (#67)`.
- `pnpm verify` passes on 2026-05-25 with 72 Turbo tasks.

### Operator lockdown UI

- Added the web `/admin` operator screen over the existing lockdown set, lift,
  and list API endpoints.
- Operator lockdown mutations run through server functions with WorkOS bearer
  forwarding, contract validation, idempotency keys, and dashboard toasts.

## 2026-05-24

### Web deploy, dashboard auth, and preview hardening

- Stable preview and production web Workers are deployed.
- Hosted web smoke asserts `/healthz` and `/api/auth/sign-in` redirect behavior.
- Per-PR web deploy is wired into preview workflow, fail-soft unless the WorkOS
  preview API key secret is present.
- Fixed live dashboard auth issuer mismatch after structured WorkOS rejection
  logging identified the real issuer.
- Fixed unauthenticated `_authed` routes returning 500 by dropping the query
  string from thrown redirects.

### CLI login

- Implemented `agent-paste login` and `agent-paste logout` with WorkOS loopback
  PKCE.
- Login mints a scoped API key via `/v1/web/keys`, stores it locally, discards
  the WorkOS token, and respects precedence `AGENT_PASTE_API_KEY` over stored
  credentials.
- Verified end-to-end against preview: login -> whoami -> logout.

### Dashboard wiring

- Dashboard loaders call live `/v1/web/*` endpoints.
- Key create/revoke and settings save run through server functions with
  idempotency keys.
- First-run key card and error toasts are implemented.
- Access Links remain a placeholder.

### Operator lockdown APIs

- Added operator-only set/lift/list lockdown endpoints.
- AP-35: versioned-secret and WorkOS rotation operator scripts with ADR 0045
  stage/flip/drain/drop plans, `@agent-paste/rotation` overlap E2E tests, and
  runbook automation section (no live production rotation in implementation).
- Operator auth accepts WorkOS operator sessions or the rotation-agent Access
  service-token identity and rejects API keys.
- Lockdowns persist in `platform_lockdowns` and write/clear KV denylist keys.

### Settings and retention

- Added `GET`/`PATCH /v1/web/settings` for workspace name and
  `auto_deletion_days`.
- Added `workspaces.auto_deletion_days` with bounds 1-90 and audit events for
  settings updates.

### Route contracts and token codec

- Implemented `packages/worker-runtime` and mounted `api`, `upload`, and
  `content` route contracts through the registrar/request guard.
- Implemented `packages/tokens` as the shared signed-token codec for content,
  Agent View, and upload URLs.

### Hosted content read throttling

- Hosted PR-preview smoke asserts artifact-level unauthenticated read throttling
  returns 429 with the expected envelope and `Retry-After`.

## 2026-05-23

- Implemented dashboard read API tranche: workspace, artifact list/detail,
  API-key list.
- Added dashboard API-key create/revoke and cursor-paginated audit reads.
- Added `workspace_members` foundation and WorkOS web callback provisioning.
- Extended secret bootstrap for WorkOS web secrets.
- Added MVP rotation runbook.
- Swapped `apps/web` from the original Auth0 scaffold to WorkOS AuthKit.
- Unified repository adapters behind a backend-agnostic `RepositoryCore`.
- Reconciled ADR 0057 denylist key drift.
- Added artifact-level read throttling in `content`.

## 2026-05-22

- Scaffolded `apps/web` as a full TanStack Start app.
- Exercised PR preview lifecycle on PR #21: Neon branch, per-PR Workers,
  hosted smoke, PR comment, and cleanup.
- Fixed production admin workspace create / scheduled cleanup failures caused by
  Drizzle/postgres-js transaction and jsonb serializer behavior.
- Made RLS migration 0003 idempotent.
- Applied Postgres RLS at runtime with tenant/platform scopes.
- Moved MVP runtime queries to Drizzle query objects and added `db:check`.
- Generated OpenAPI from Zod contracts and golden-checked it in `pnpm verify`.
- Completed the cross-Worker error envelope with request IDs.
- Fixed PR preview cleanup workflow registration.

## 2026-05-21

- Verified bytes-after-delete and bytes-after-expiry cleanup in hosted smoke.
- Audited CSP allowlist behavior with snapshots.
- Enforced native rate-limit bindings for authenticated routes.
- Consolidated content signing secret names.
- Wired `runCommand` and operation events into mutation routes.
- Added `--yes` guards to destructive admin CLI commands.
- Closed obsolete `t3code/*` branch references.
