# Code duplication limit: ratchet plan

Source of truth for the jscpd copy-paste gate and the duplication that is
currently tolerated. Owner: Isaac. Snapshot date: 2026-06-05.

jscpd 4.2.x enforces a single duplication `threshold` in `.jscpd.json` (run via
`pnpm dupes` -> `node scripts/jscpd-check.mjs`, wired into `pnpm verify` after
`pnpm knip`). The build fails when total duplicated lines exceed the threshold
percentage.

## Scope

The gate covers **shipped code only**: `apps/` and `packages/`. It does not scan
`scripts/`, tests, generated files, or vendored output. Rationale:

- Duplication concentrates in `scripts/*.mjs` (PR-preview and secret-rotation
  glue), which churns fast and is low-stakes; gating it would just generate
  noise and block unrelated PRs. Shipped code is what users depend on.
- Tests legitimately repeat setup/assertions, same as the complexity gate's
  test exemption. See [complexity-todo.md](./complexity-todo.md).

Ignored globs (in `.jscpd.json`): `node_modules`, `dist`, `.turbo`,
`.wrangler`, `coverage`, `*.gen.ts`, `worker-configuration.d.ts`,
`openapi/*.json`, and all `*.test.*` / `*.spec.*` / `__tests__` / `test`.
Known friction: helpers under `src/test-helpers/` are currently scanned because
that path is not covered by the ignore list. They contribute real duplicated
lines today but are test support, not shipped runtime behavior.

| Setting     | Current value | Next step  | Ratchet target |
| ----------- | ------------- | ---------- | -------------- |
| `minTokens` | 50            | stay at 50 | stay at 50     |
| `threshold` | 2.0 (%)       | 1.9 (%)    | 1.5 (%)        |

The threshold is set to the tightest value that is **green today without a wave
of refactors**. It started at `3` (baseline 2.84%); quick-win extractions pulled
the baseline below the `2.7` gate, AP-203 pulled it below the `2.5` gate, AP-206
pulled it to **2.33%**, AP-207 plus the merged cleanup/test/docs train pulled it
below the `2.1` gate, AP-204 pulled it to **1.95%**, and the threshold ratcheted
`2.1 -> 2.0` on 2026-06-05 (no refactor; AP-226's local SQL executor split plus
AP-228's DB entity-bag split pulled the baseline to **1.88%**). The current
baseline (**1.88%**) is below the `2.0` gate but not yet low enough for `1.9`.
The next step (`1.9`) needs another offender cleanup or a decision to stop
scanning `src/test-helpers/`. Lower the threshold in `.jscpd.json` as offenders
are cleaned up and update this file.

Gate mechanics note: jscpd's `ThresholdReporter` compares the threshold against
`statistic.total.percentage` (the **Total** row, 1.88%), not any per-format row.
The per-format console table can show TypeScript at 2.06% while the gate still
passes, because only the total is checked. Run the gate via `pnpm dupes` (which
puts `node_modules/.bin` on PATH) — invoking `node scripts/jscpd-check.mjs`
directly from a shell without that PATH makes the bare `jscpd` spawn fail with a
misleading exit 1.

## Baseline distribution (gated scope, 2026-06-05)

Measured by `pnpm dupes` at `minTokens: 50` over `apps` + `packages`:

- Current (2026-06-05, post AP-226 SQL executor + AP-228 entity-bag splits): 593
  files, 50,024 lines analyzed; 93 clones, 941 duplicated lines = **1.88%**
  (2.31% by tokens).
- By format (current): TypeScript 2.06%, TSX 1.58%, JavaScript 0%. Only the
  Total (1.88%) is gated — see the gate-mechanics note above.
- Prior (AP-204): 519 files, 46,947 lines, 92 clones, 916 duplicated lines =
  **1.95%** (2.30% by tokens). TypeScript 2.15%, TSX 1.60%.

For reference, `scripts/` alone is 9.46% (62 clones, 810 duplicated lines over
8,558 lines). That gap is why `scripts/` is out of scope.

## Done: first dedup round

These quick wins shipped with the gate (2.84% -> 2.59%):

- [x] `appErrorResponse` / `jsonResponse`: removed byte-identical local response
      wrappers in `apps/api/src/responses.ts` and `apps/upload/src/index.ts`;
      the docs-URL-aware error wrapper now lives in
      `packages/worker-runtime/src/errors.ts`.
- [x] Byte-purge invalidation twins: extracted `writeDenylistKey` and
      `enqueueBytePurge` into `packages/db/src/byte-purge-shared.ts`;
      `artifact-invalidation.ts` and `revision-invalidation.ts` are now thin
      callers that differ only by KV prefix / purge prefix.
- [x] `liveStreamProxyHeaders`: shared the SSE proxy header-copy across the two
      `apps/web/src/routes/api/live/*` route files; lives in
      `apps/web/src/security-headers.ts`.

## Done: AP-203 repository workflow dedup

This pass moved the gated baseline from 2.54% to 2.45%:

- [x] Shared active-artifact lookup, artifact audit insertion, delete-result
      mapping, and web artifact pagination in
      `packages/db/src/repository/workflows/artifact-workflow-helpers.ts`.
- [x] Reused those helpers from member artifact, web dashboard, access-link, and
      workspace-admin workflows.
- [x] Collapsed the workspace replay peek wrappers into one implementation with
      explicit exported aliases.

## Done: AP-206 MCP helper dedup

This pass moved the gated baseline from 2.45% to 2.33%:

- [x] Extracted `createAndMintAccessLink` in `apps/mcp/src/tools.ts` for the
      shared create-and-mint Access Link flow used by `set_visibility` (then named
      `create_share_link`) and `create_revision_link`.
- [x] Extracted `forwardToBinding` in `apps/mcp/src/forward.ts` for shared API
      vs Upload request construction and error mapping.

## Done: AP-204 dashboard table/status UI dedup

This pass moved the gated baseline from 2.33% to 2.21%:

- [x] Shared clipboard-copy hook, revocable entity state, and presentational
      table helpers (`DataTable`, `StateBadge`, `OptionalRelativeTime`,
      `RevokedActionPlaceholder`) across Access Links and API Keys tables in
      `apps/web`.

## Done: AP-207 API route helper dedup

This pass, combined with the cleanup/test/docs train merged into `main`, moved
the gated baseline from 2.33% to 2.00%:

- [x] Shared Workspace Member resolution, forbidden response handling, and
      paginated member route execution in `apps/api/src/routes/web.ts`.
- [x] Shared member billing route execution and current-status response building
      in `apps/api/src/routes/billing.ts`.
- [x] Shared smoke harness authentication and smoke DB resolution in
      `apps/api/src/routes/smoke.ts`.
- [x] Collapsed repository route error mapping in `apps/api/src/responses.ts`.

## Where the duplication lives

Cleaning these dirs is what moves the threshold:

- [ ] `packages/db/src/repository/workflows/*` — `web-dashboard-workflow.ts`,
      `member-artifacts-workflow.ts`, `access-links-workflow.ts`, and siblings
      repeat row-mapping, pagination, command setup, and Audit Event boilerplate.
      Largest single runtime source of clones.
- [ ] API Worker glue — AP-207 removed the route-local member, pagination,
      response, smoke, and repository-error clones; non-route `index.ts` /
      `env.ts` / deletion-invalidation clones remain.
- [ ] `packages/db/src/repository/web-transforms.ts` — repeated transform
      shapes (3 clones).
- [ ] `packages/db/src/queries/*` and `local-entities/*` — repeated query
      scaffolding (`operation-events.ts`, `artifacts.ts`).
- [x] `packages/db/src/local-mvp-sql-executor.ts` — AP-226 split the monolithic
      branch table into focused statement handlers under
      `packages/db/src/local-mvp-sql-executor/`, removing the repeated handler
      bodies and the complexity suppressions in one pass.
- [ ] `packages/contracts/src/openapi/*` — repeated schema/registration blocks
      (MCP publish-chain clone in `mcp/registry.ts` deduped in AP-205).
- [ ] `apps/web/src/components/*` — a few route loaders and admin panels still
      repeat small UI patterns.
- [ ] `apps/upload/src/create-session.ts` and `finalize.ts` — repeated
      authenticated upload-route repository error handling.
- [ ] `apps/jobs/src/test-helpers/*` and `packages/billing/src/test-helpers/*`
      — repeated PGlite migration/RLS helper setup. Either extract a shared test
      helper or stop scanning `src/test-helpers/`.
- [ ] `packages/rotation/src/automation.ts` — 2 clones in plan-building.

Some jscpd hits are intentional parallel implementations, not copy-paste, and
should be left alone: `apps/stream/src/artifact-live.ts` vs
`memory-artifact-live.ts` (DurableObject vs in-memory), the per-domain jobs
queue/discovery handlers, and `schema.ts` column blocks (clearer flat than
abstracted). The repeated smoke-script helpers under `scripts/` are also outside
the gate by design.

## How to ratchet

1. Refactor one or more offender dirs above (extract shared helpers).
2. Re-measure: `pnpm dupes` (or `pnpm dupes --reporters json` for a machine
   summary).
3. Lower `threshold` in `.jscpd.json` to just above the new percentage.
4. Repeat until the ratchet target (1.5%) is reached, then delete this file.
