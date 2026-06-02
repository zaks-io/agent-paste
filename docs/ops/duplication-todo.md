# Code duplication limit: ratchet plan

Source of truth for the jscpd copy-paste gate and the duplication that is
currently tolerated. Owner: Isaac. Snapshot date: 2026-06-02.

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

| Setting     | Current value | Next step  | Ratchet target |
| ----------- | ------------- | ---------- | -------------- |
| `minTokens` | 50            | stay at 50 | stay at 50     |
| `threshold` | 2.7 (%)       | 2.5 (%)    | 1.5 (%)        |

The threshold was set to the tightest value that is **green today without a wave
of refactors**. It started at `3` (baseline 2.84%); an initial round of quick-win
extractions (see below) pulled the baseline to **2.59%**, so the gate was
ratcheted to `2.7`. The next step (`2.5`) needs the workflow row-mapping dedup
in `packages/db/src/repository/workflows/*`. Lower the threshold in
`.jscpd.json` as offenders are cleaned up and update this file.

## Baseline distribution (gated scope, 2026-06-02)

Measured by jscpd at `minTokens: 50` over `apps` + `packages`, after the first
dedup round:

- 393 files, 35,784 lines analyzed.
- 91 clones, 927 duplicated lines = **2.59%** (2.87% by tokens).
- By format: TypeScript ~2.9%, TSX 1.23%, JavaScript 0%.

For reference, the whole repo including `scripts/` is ~3.9% (the scripts alone
are ~8.5%). That gap is why `scripts/` is out of scope.

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

## Where the duplication lives

Diffuse across `packages/db`, not a few fat offenders. Cleaning these dirs is
what moves the threshold:

- [ ] `packages/db/src/repository/workflows/*` — `web-dashboard-workflow.ts`,
      `member-artifacts-workflow.ts`, and siblings repeat row-mapping and
      pagination boilerplate. Largest single source of clones.
- [ ] `packages/db/src/repository/web-transforms.ts` — repeated transform
      shapes (3 clones).
- [ ] `packages/db/src/queries/*` and `local-entities/*` — repeated query
      scaffolding (`operation-events.ts`, `artifacts.ts`).
- [ ] `packages/db/src/local-mvp-sql-executor.ts` — repeated statement-handler
      bodies (also a complexity offender; refactoring helps both gates).
- [ ] `packages/contracts/src/openapi/*` and `mcp/registry.ts` — repeated
      schema/registration blocks (largest single clone: 45 lines in
      `mcp/registry.ts`).
- [ ] `packages/rotation/src/automation.ts` — 2 clones in plan-building.

Some jscpd hits are intentional parallel implementations, not copy-paste, and
should be left alone: `apps/stream/src/artifact-live.ts` vs
`memory-artifact-live.ts` (DurableObject vs in-memory), the per-domain jobs
queue/discovery handlers, and `schema.ts` column blocks (clearer flat than
abstracted).

## How to ratchet

1. Refactor one or more offender dirs above (extract shared helpers).
2. Re-measure: `pnpm dupes` (or `pnpm dupes --reporters json` for a machine
   summary).
3. Lower `threshold` in `.jscpd.json` to just above the new percentage.
4. Repeat until the ratchet target (1.5%) is reached, then delete this file.
