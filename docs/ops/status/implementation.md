# Implementation State

Last updated: 2026-06-15 (AP-139 production agent smoke refresh; production
workflow, CLI release, and MCP tool-text follow-up are current).

## Snapshot

- `main` contains the early-alpha public-repo hardening work, AP-139 production
  agent smoke fixes, the `@zaks-io/agent-paste@0.1.8` CLI release, and the MCP
  recovery/tool-description follow-up.
- AP-99 through AP-111 add Ephemeral Workspace provisioning, claim, CLI
  `--ephemeral`, web claim UX, script-disabled/noindex serving, and local +
  hosted ephemeral smokes. Operator notes:
  [`runbook-ephemeral-publish.md`](../runbook-ephemeral-publish.md).
- AP-156 ships dashboard Access Link management (member `/v1/web/*` routes plus
  list/create/mint/revoke/lockdown UI); AP-164 adds the TanStack Query client
  cache and SSE-driven live dashboard. AP-161/AP-162 make artifact TTL
  server-side-only and heal stale `claimed_at` on web-member login. AP-109
  ships the post-claim free-to-pro success funnel and upgrade CTA.
- CI, Security, CodeQL, Scorecard, and production deploy workflows are green on
  current `main` at this refresh. The production deploy blocker from stale
  `SMOKE_HARNESS_SECRET` on `agent-paste-api-production` was cleared on
  2026-06-07.
- The credential-free production read-only smoke passed locally on 2026-06-07:
  reachable worker health, apex routes, MCP metadata/challenge, and web
  sign-in redirect. It still does not prove content-byte serving; AP-144 owns
  the pinned canary follow-up. The production deploy now runs this read-only
  canary in place of the removed authed smoke (AP-138).

## Components

| Component                 | Status                      | Notes                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/apex`               | Implemented                 | Marketing/apex Worker, auth vanity redirects, agent-facing copy, and tests.                                                                                                                                                                                                                                                                                                                         |
| `apps/api`                | Implemented                 | Public Agent View, dashboard APIs, WorkOS callback/member provisioning, operator APIs, operator event browsing, revision publish/list, `POST /v1/ephemeral/provision`, and `POST /v1/ephemeral/claim`.                                                                                                                                                                                              |
| `apps/upload`             | Implemented                 | Session create (including update sessions), signed upload-worker PUTs, R2 writes, finalize to draft revision.                                                                                                                                                                                                                                                                                       |
| `apps/content`            | Implemented                 | Signed content-token verification, private R2 reads/decrypt, CSP/security headers, noindex ephemeral serving, script-disabled ephemeral CSP via content-token bit, extension-derived MIME, denylist, read throttling.                                                                                                                                                                               |
| `apps/cli`                | Implemented                 | `publish` (finalize + publish) with `--ephemeral`, optional `--artifact-id` updates, `whoami`, `login`, `logout`, local credential storage, and API-client plumbing.                                                                                                                                                                                                                                |
| `apps/web`                | Implemented with gaps       | WorkOS AuthKit, dashboard routes, live loaders/mutations, operator lockdown UI, operator event browsing, Lighthouse a11y gate, hardened PR-preview readiness, deployed preview/production. Access Link `/al/{publicId}` viewer and resolve proxy route ship; dashboard Access Link management UI (list/create/mint/revoke/lockdown on `/access-links` and artifact detail) is implemented (AP-156). |
| `apps/jobs`               | Implemented for current app | Cron discovery (upload cleanup, 24h ephemeral auto-deletion, auto-deletion skipping pinned artifacts, retention for non-current revisions, billing reconciliation, purge recovery, maintenance GC), queue consumers + DLQs, bundle zip generation + DLQ `mark_failed`, built-in and ephemeral-tier safety scan warning replacement (AP-21/22/23/24/33/104).                                         |
| `apps/mcp`                | Implemented                 | Streamable HTTP MCP transport, WorkOS JWT verification, fourteen-tool surface, API/upload forwarding, hosted/local smoke (`pnpm smoke:mcp`). See [`docs/ops/runbook-mcp-hosts.md`](../runbook-mcp-hosts.md).                                                                                                                                                                                        |
| `apps/stream`             | Implemented                 | Live Updates Worker (ADR 0069): per-artifact Durable Objects, SSE fan-out, `stream -> api` authorize binding, viewer cap (AP-25).                                                                                                                                                                                                                                                                   |
| `packages/contracts`      | Implemented for current app | Zod schemas, route registry, OpenAPI goldens for current REST surfaces including Access Link resolve request/response and status-discriminated bundle availability. MCP OAuth scopes, JSON-RPC transport shapes, fourteen-tool registry, error mapping, and forwarded API call plans (AP-27).                                                                                                       |
| `packages/worker-runtime` | Implemented                 | Contract-driven route registrar, request guard, auth principal model, error map, and rate-limit application.                                                                                                                                                                                                                                                                                        |
| `packages/db`             | Implemented for current app | Drizzle schema/migrations, RLS, repository core/adapters, `revisions` table with bundle availability columns and publish-update flow. Access Links, Safety Warnings, `workspace_billing`, `claim_tokens`, and Ephemeral Workspace provisioning are present.                                                                                                                                         |
| `packages/tokens`         | Implemented                 | Shared signed-token codec and content, Agent View, upload URL, Access Link, and proof-of-work modules.                                                                                                                                                                                                                                                                                              |
| `packages/auth`           | Implemented                 | WorkOS/MCP auth primitives, auth cache, scope registry, and request IDs.                                                                                                                                                                                                                                                                                                                            |
| `packages/api-client`     | Implemented                 | CLI/web-facing client helpers, retry/idempotency/cursor handling, CLI key mint path.                                                                                                                                                                                                                                                                                                                |
| `packages/commands`       | Implemented                 | `runCommand`, operation events, idempotency helpers.                                                                                                                                                                                                                                                                                                                                                |
| `packages/storage`        | Implemented                 | MIME map, security header helpers, and app-layer Artifact bytes encryption/decryption helpers.                                                                                                                                                                                                                                                                                                      |
| `packages/config`         | Implemented                 | Shared config constants including ephemeral auto-deletion policy.                                                                                                                                                                                                                                                                                                                                   |
| `packages/billing`        | Implemented                 | Plan tiers, plan-derived caps, the Stripe `BillingProvider` (Checkout, idempotent webhooks, Portal, operator override, invoices, AP-5), sync/reconciliation, and drift logging. Billing routes/Stripe import only when `BILLING_ENABLED` is set. The `/billing` dashboard ships in `apps/web` (AP-176).                                                                                             |
| `packages/rotation`       | Implemented                 | Signing/content/API-pepper/WorkOS/artifact-bytes key-ring helpers plus rotation scripts/tests.                                                                                                                                                                                                                                                                                                      |
| `packages/repo-lint`      | Implemented                 | Repo policy checks and docs/scripts lint wiring.                                                                                                                                                                                                                                                                                                                                                    |

## Planned But Absent

| Planned item                    | Earliest phase | Current state                                                                                                                                                                                 |
| ------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe Checkout/webhooks/Portal | Post-launch    | Done (AP-5): implemented behind `BILLING_ENABLED`. Preview/test-mode verification completed by Isaac on 2026-06-07; final production smoke only if billing is enabled for paid public launch. |
| Hosted billing UI               | Post-launch    | Done (AP-176): `/billing` dashboard with plan, subscription, live allowance, and Stripe invoices.                                                                                             |
| Ephemeral claim/upgrade funnel  | Post-launch    | Done (AP-109): provision, claim API, CLI `--ephemeral`, web `/claim`, post-claim success UI, upgrade CTA, and smokes ship.                                                                    |
| Access Link management UI       | Phase 4        | Done (AP-156): `/v1/web/*` member routes + dashboard list/create/mint/revoke/lockdown UI on `/access-links` and artifact detail.                                                              |

## Known Implementation Gaps

- Future jobs hardening may add new queue families, but lifecycle byte purge,
  retention, bundle zip generation, DLQ terminal failure handling, and safety
  warning replacement are implemented.
- `apps/mcp` ships OAuth-only MCP with local and hosted smoke; see
  [`docs/ops/runbook-mcp-hosts.md`](../runbook-mcp-hosts.md).
- `apps/web/src/routes/_authed.admin.tsx` now exposes the Phase 3 operator
  lockdown UI plus AP-16 operator event browsing over WorkOS operator APIs.
- `packages/db` has workspace/member/key/artifact/revision/audit/lockdown state
  plus Access Link rows, bundle availability, Safety Warning persistence,
  `workspace_billing`, and `claim_tokens`.

## Verification

| Check                      | Latest known result | Date       | Notes                                                                                                                           |
| -------------------------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| CI `Validate` on `main`    | Pass                | 2026-06-15 | `CI`, `Security`, `CodeQL`, and Scorecard workflows green on current `main`.                                                    |
| `pnpm verify`              | Pass                | 2026-06-04 | 88 Turbo tasks successful on `main` after a clean `pnpm install`.                                                               |
| `pnpm smoke:local`         | Pass                | 2026-05-24 | Last recorded after route registrar/token work.                                                                                 |
| `pnpm smoke:preview`       | Pass                | 2026-05-24 | Preview web and WorkOS login were verified during Phase 3 work.                                                                 |
| `pnpm smoke:production`    | Pass                | 2026-05-22 | Full publish + Agent View + content fetch chain green after production deploy.                                                  |
| `pnpm smoke:prod:readonly` | Pass                | 2026-06-07 | Credential-free production canary passed locally: worker health, apex, MCP metadata/challenge, and web sign-in redirect.        |
| `Deploy Production`        | Pass                | 2026-06-15 | Production workflow succeeded with migration, Worker deploy, release security attestation, and read-only production smoke.      |
| PR preview lifecycle       | Pass                | 2026-05-25 | Readiness gate polls `/healthz` with consecutive 200s and retries 404/530 flakes; docs-only PRs skip deploy via `paths-ignore`. |
