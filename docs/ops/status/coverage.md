# Coverage Ledger

Last updated: 2026-05-25.

Status legend:

- **Done** - implementation matches the current decision/spec for the relevant
  phase.
- **Partial** - useful code exists, but material gaps remain.
- **Drift** - docs and implementation intentionally or accidentally diverge.
- **Deferred** - accepted future work, not active in the current phase.
- **Superseded** - historical decision replaced by a later ADR.

## Spec Coverage

| Spec                              | Status   | Notes                                                                                                                                                      |
| --------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/specs/README.md`            | Done     | Reading-order index.                                                                                                                                       |
| `docs/specs/mvp.md`               | Done     | CLI-first MVP is implemented; Phase 3 additions intentionally extend beyond this MVP spec.                                                                 |
| `docs/specs/phases.md`            | Partial  | Phase 1 complete, Phase 3 active close-out, Phases 4-6/post-launch mostly unimplemented.                                                                   |
| `docs/specs/features.md`          | Drift    | Still marks some now-built Phase 3 work as future/Phase 6. Use `phase-backlog.md` for current ordering.                                                    |
| `docs/specs/api.md`               | Done     | MVP REST routes implemented; later dashboard routes live in contracts/API but the spec still reads MVP-first.                                              |
| `docs/specs/data-model.md`        | Partial  | Current schema/RLS implemented; Phase 4 Access Link/revision/bundle/scanner and billing tables absent.                                                     |
| `docs/specs/content-rendering.md` | Done     | Signed content tokens, MIME, CSP, denylist, cache, and artifact read throttling are implemented.                                                           |
| `docs/specs/admin.md`             | Partial  | Repo-local admin CLI and the web operator lockdown UI work; richer operator browsing remains future.                                                       |
| `docs/specs/acceptance.md`        | Done     | MVP acceptance covered by local/hosted smoke and worker tests; later phases are explicit non-goals there.                                                  |
| `docs/specs/contracts.md`         | Done     | Current REST contracts are canonical; future MCP/Access Link/bundle schemas remain out of current contracts.                                               |
| `docs/specs/local-dev.md`         | Done     | `pnpm dev:all`, local harness, and local smoke are present for the MVP surface.                                                                            |
| `docs/specs/product-judgment.md`  | Done     | Philosophy doc.                                                                                                                                            |
| `docs/specs/style-guide.md`       | Partial  | Web applies tokens/components; per-route titles remain.                                                                                                    |
| `docs/specs/jobs.md`              | Deferred | Phase 4 jobs worker design. `apps/jobs` is scaffold-only; MVP cleanup still lives in `api` scheduled/manual cleanup.                                       |
| `docs/specs/web.md`               | Partial  | WorkOS AuthKit dashboard auth/read/mutation basics and operator lockdown UI are live; Access Link viewer is a placeholder; per-route titles polish remain. |

## ADR Coverage

| ADR                                   | Status               | Notes                                                                                                                                                              |
| ------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0001 private artifact storage         | Done                 | Private R2 plus controlled content origin.                                                                                                                         |
| 0002 Auth0 for workspace auth         | Superseded           | Superseded for web by ADR 0068; CLI uses WorkOS per ADR 0060.                                                                                                      |
| 0003 restrict artifact JS network     | Done                 | Content CSP restricts network egress.                                                                                                                              |
| 0004 audit wrapper                    | Done                 | Mutations run through `runCommand` with operation events.                                                                                                          |
| 0005 Workers/R2/Postgres/Hyperdrive   | Done                 | Current runtime uses the intended platform pieces.                                                                                                                 |
| 0006 small Workers by boundary        | Done                 | `api`, `upload`, `content`, `web`, `jobs`, `mcp`, `apex` split exists; some are scaffolds.                                                                         |
| 0007 migrations/preview envs          | Done                 | Migration runner, db snapshot check, shared preview, and PR previews exist.                                                                                        |
| 0008 pnpm/Turbo guardrails            | Done                 | Workspace tooling and guardrails configured.                                                                                                                       |
| 0009 per-app Cloudflare config        | Done                 | Per-app `wrangler.jsonc`.                                                                                                                                          |
| 0010 GitHub Actions                   | Done                 | CI, PR preview, cleanup, and production deploy workflows exist.                                                                                                    |
| 0011 Cloudflare observability         | Partial              | Worker observability enabled; Logpush/Axiom click-ops parked.                                                                                                      |
| 0012 preview/production envs          | Done                 | Preview and production envs are the deployed targets.                                                                                                              |
| 0013 wrangler-first local dev         | Done                 | Local MVP server and dev commands exist.                                                                                                                           |
| 0014 single domain/hardened subdomain | Partial              | Core custom domains live; Access Link and MCP/Jobs final surfaces pending.                                                                                         |
| 0015 shared auth primitives           | Done for current app | Shared auth/cache exists; Access Link portions superseded by ADR 0047.                                                                                             |
| 0016 Hono/OpenAPI                     | Done                 | Hono Workers and generated OpenAPI for current REST surfaces.                                                                                                      |
| 0017 OpenAPI/SDK/CLI                  | Partial              | API client and CLI exist; public SDK/regeneration pipeline remains future/manual.                                                                                  |
| 0018 Drizzle                          | Partial              | Runtime queries moved to Drizzle; some admin/cleanup set-based SQL remains raw by design.                                                                          |
| 0019 Cloudflare Queues/jobs           | Deferred             | Phase 4. `apps/jobs` has no consumers yet.                                                                                                                         |
| 0020 content caching                  | Partial              | Cache headers set; final revision/bundle cache semantics wait on Phase 4.                                                                                          |
| 0021 R2 object key layout             | Done                 | Current object keys follow ID-based layout.                                                                                                                        |
| 0022 idempotent mutations             | Done                 | Current mutation routes use durable idempotency.                                                                                                                   |
| 0023 versioned REST APIs              | Done                 | Public routes are under `/v1`; admin under `/admin`.                                                                                                               |
| 0024 untrusted agent data             | Partial              | Main safety baseline implemented; future scanner/renderer surfaces remain.                                                                                         |
| 0025 Biome/Lefthook/Vitest            | Done                 | Configured and passing.                                                                                                                                            |
| 0026 Turbo remote cache               | Done                 | Signed remote cache configured.                                                                                                                                    |
| 0027 upload write path                | Done for current app | Upload Worker owns PUT/finalize; app-layer encryption piece deferred by ADR 0063/0066.                                                                             |
| 0028 signed content URLs              | Done                 | Implemented through `packages/tokens`.                                                                                                                             |
| 0029 renderer pages                   | Deferred             | Markdown/text renderers deferred until needed.                                                                                                                     |
| 0030 MVP CSP                          | Partial              | Content CSP implemented; Access Link viewer CSP finalization waits on Phase 4.                                                                                     |
| 0031 kid content URL rotation         | Superseded           | Folded into ADR 0028/0071 for current content tokens.                                                                                                              |
| 0032 jobs topology                    | Deferred             | Phase 4.                                                                                                                                                           |
| 0033 TanStack Start web               | Partial              | WorkOS AuthKit dashboard is live with operator lockdown UI, Cmd-K palette, and Lighthouse a11y gate; Access Link viewer is a placeholder; per-route titles remain. |
| 0034 unified scopes                   | Partial              | Current API key/member scopes implemented; MCP delegated-surface rule waits on Phase 5.                                                                            |
| 0035 runCommand sequencing            | Done                 | Transactional command/event/idempotency pattern implemented.                                                                                                       |
| 0036 error envelope                   | Done                 | Current Workers return envelope with request IDs.                                                                                                                  |
| 0037 api-client powers CLI            | Done                 | CLI uses `packages/api-client`.                                                                                                                                    |
| 0038 Zod source of truth              | Partial              | Current schemas/routes are Zod-backed; future surfaces absent.                                                                                                     |
| 0039 authenticated rate limits        | Done                 | Native rate-limit bindings applied for current `api`/`upload` traffic.                                                                                             |
| 0040 platform lockdown                | Done for current app | API set/lift/list and the operator web UI are implemented for the Phase 3 surface.                                                                                 |
| 0041 upload size caps                 | Done                 | Current upload caps enforced.                                                                                                                                      |
| 0042 extension content type           | Done                 | Served MIME derives from extension allowlist.                                                                                                                      |
| 0043 bearer credential format         | Done                 | API key format implemented; Access Link half superseded by ADR 0047.                                                                                               |
| 0044 workspace RLS                    | Done                 | RLS forced and runtime-scoped.                                                                                                                                     |
| 0045 secret rotation                  | Partial              | Manual runbook exists; tested automated multi-key/multi-pepper rotation absent.                                                                                    |
| 0046 operator identity/admin surface  | Partial              | WorkOS/Access/operator API paths and lockdown UI exist; rotation automation remains.                                                                               |
| 0047 Access Link signed URL           | Deferred             | Phase 4.                                                                                                                                                           |
| 0048 transient artifacts              | Partial              | TTL/deletion/read throttling implemented; pinning/revision retention remain.                                                                                       |
| 0049 jobs handlers                    | Deferred             | Phase 4.                                                                                                                                                           |
| 0050 bundle availability/DLQ          | Deferred             | Phase 4.                                                                                                                                                           |
| 0051 safety scanner lifecycle         | Deferred             | Phase 4 stub/Phase 6 real scanner.                                                                                                                                 |
| 0052 Agent View from Access Link      | Deferred             | Phase 4 Access Link resolve/discovery.                                                                                                                             |
| 0053 manifest shape                   | Deferred             | Phase 4 multi-revision/bundle/warning manifest expansion.                                                                                                          |
| 0054 Agent View envelope              | Done                 | Current public Agent View shape implemented.                                                                                                                       |
| 0055 signup auto-provision            | Done                 | Dashboard and CLI login provision Personal Workspace/member/default or minted key.                                                                                 |
| 0056 MVP usage policy                 | Done                 | Current caps align with MVP defaults.                                                                                                                              |
| 0057 KV denylist keys                 | Done for current app | Artifact/workspace/platform denylist keys implemented for current surfaces.                                                                                        |
| 0058 first-deploy bootstrap           | Partial              | Current secrets bootstrapped; future Access Link/encryption/billing secrets absent.                                                                                |
| 0059 web session/auth forwarding      | Implemented          | Auth forwarding, first-load race fix, WorkOS runbook, and deep-link return paths via the sign-in bridge route.                                                     |
| 0060 CLI auth via WorkOS loopback     | Done                 | `login`/`logout` implemented and preview-verified.                                                                                                                 |
| 0061 MCP OAuth-only                   | Deferred             | Phase 5; provider likely needs re-decision away from Auth0 wording.                                                                                                |
| 0062 auth cache                       | Done                 | `cachedLookup` wired into current auth paths.                                                                                                                      |
| 0063 app-layer encryption             | Deferred             | Phase 6.                                                                                                                                                           |
| 0064 native rate-limit bindings       | Done                 | Current rate-limit bindings are used.                                                                                                                              |
| 0065 wrangler JSONC                   | Done                 | All current Workers use JSONC config.                                                                                                                              |
| 0066 CLI-first MVP narrowing          | Done                 | Controlling MVP scope.                                                                                                                                             |
| 0067 interim security baseline        | Done                 | Recorded and mostly implemented; follow-ups tracked in later phases.                                                                                               |
| 0068 WorkOS AuthKit                   | Done                 | Web AuthKit migration and live WorkOS login are implemented; operator runbook at `docs/ops/runbook-workos.md`.                                                     |
| 0069 Live Updates                     | Deferred             | Phase 4 after revisions, Share Links, and viewer surfaces.                                                                                                         |
| 0070 repository core                  | Done                 | Core/adapters implemented; cleanup follow-ups in `repository-todo.md`.                                                                                             |
| 0071 signed-token codec               | Done                 | `packages/tokens` implemented.                                                                                                                                     |
| 0072 route registrar                  | Done                 | `packages/worker-runtime` implemented for `api`, `upload`, and `content`.                                                                                          |
| 0073 open-core billing plans          | Deferred             | Post-launch; no `packages/billing` or `workspaces.plan` yet.                                                                                                       |
| 0074 Stripe sync layer                | Deferred             | Post-launch; no Stripe routes/webhooks/reconciliation yet.                                                                                                         |
