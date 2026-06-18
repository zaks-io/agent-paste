# Dependency-cruiser: rule baseline and ratchet plan

Source of truth for the module-dependency-graph gate (AP-372). Owner: Isaac.
Snapshot date: 2026-06-17.

[dependency-cruiser](https://github.com/sverweij/dependency-cruiser) validates
the import graph across the monorepo. Rules live in
[`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs); the gate runs via
`pnpm depcruise` (`node scripts/depcruise-check.mjs`), wired into `pnpm verify`
right after `pnpm dupes`, so it gates CI `Validate` and the Lefthook `pre-push`
hook. The build fails on any rule at severity `error`; `warn` rules print but do
not fail.

## Scope

Cruises **shipped source only**: `apps/` and `packages/`, scanned from each
package's source. Excluded (in the config `options.exclude`): build output
(`dist/`, `.output/`, `.turbo/`, `.wrangler/`), local coverage reports
(`coverage/`), generated files (`*.gen.ts`, `worker-configuration.d.ts`), and
test material (`*.test.*` / `*.spec.*`, `__tests__/`, `test/`, `test-helpers/`).
There is deliberately no bare `build/` exclude: no `build/` output dir exists in
this repo, and the pattern would wrongly swallow the `apps/apex/src/build/`
source dir.

`test-helpers/` is excluded because shared e2e harnesses legitimately wire two
Workers together (e.g. `apps/api/src/test-helpers/live-updates-e2e-harness.ts`
imports `apps/stream`), which would otherwise trip `not-to-other-app`. The
gate's job is to protect the import topology of code that ships, not test glue.

Resolution is tuned for this all-ESM, pnpm-workspace, `moduleResolution: bundler`
repo: `combinedDependencies: true` walks package.json up the tree (needed for
workspace resolution), `tsConfig` points at `tsconfig.base.json`,
`tsPreCompilationDeps: true` makes type-only imports visible, and
`enhancedResolveOptions` reads the `exports`/`import` conditions.

## Rules

### Blocking (`error`)

| Rule                      | What it catches                                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-circular`             | A runtime import cycle. Type-only cycles are excluded (TypeScript erases them). Break a cycle by inverting a dependency or moving the shared piece into a leaf module both sides import.                         |
| `no-orphans`              | A module nothing imports and that imports nothing — dead code. Config/declaration files and framework entrypoints reached only via generated files (TanStack `routeTree.gen.ts`) are exempted in `from.pathNot`. |
| `not-to-unresolvable`     | Imports that don't resolve to disk. `cloudflare:` virtual modules are exempt (Workers runtime, like `node:`).                                                                                                    |
| `not-to-spec`             | Non-test code importing a `*.test.*` / `*.spec.*` file.                                                                                                                                                          |
| `not-to-dev-dep`          | Shipped `src` code importing a `devDependency` (absent in production).                                                                                                                                           |
| `not-to-app-from-package` | A `packages/*` module importing an `apps/*` module. The dependency only ever points package <- app.                                                                                                              |
| `not-to-other-app`        | One app importing another app's source. Apps are deployment units; they talk over HTTP / service bindings / queues (ADR 0006).                                                                                   |
| `content-stays-isolated`  | `apps/content` importing `packages/db`, `packages/billing`, `postgres`, or `drizzle-orm` (ADR 0028). The request-id middleware from `packages/auth` is allowed — it is a cross-cutting helper, not WorkOS auth.  |
| `stream-stays-isolated`   | `apps/stream` importing `packages/db`, `postgres`, or `drizzle-orm`. Stream is SSE/Durable-Object fan-out only; it authorizes via `api`, not the DB.                                                             |

### Advisory (`warn`) — non-blocking, surfaced for cleanup

| Rule                     | Why it is advisory, not blocking                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-deprecated-core`     | Deprecated Node core modules. `async_hooks` is intentionally **not** listed: the repo uses the supported `node:async_hooks` form for the ALS CSP-nonce bridge. |
| `not-to-deprecated`      | Deprecated npm packages.                                                                                                                                       |
| `no-duplicate-dep-types` | A package declared under more than one dependency type.                                                                                                        |

## Baseline (2026-06-17)

`pnpm depcruise`: **0 errors, 0 warnings** over 632 modules / 2225 dependencies.
`no-circular` and `no-orphans` are both clean and blocking.

The earlier orphan warnings were all false positives and are now resolved:
the two apex install-script modules (`install-sh.ts` / `install-ps1.ts`) were
flagged because the over-broad `(^|/)build/` exclude was swallowing their
importer `apps/apex/src/build/text-assets.ts` (no `build/` _output_ dir exists
in this repo — `dist/`/`.output/` already cover output), so that exclude was
removed. The two `apps/web` entrypoints (`start.ts`, the auth-callback route)
are reached only through `routeTree.gen.ts` (excluded as generated), so they
are exempted in the `no-orphans` `from.pathNot` as framework entrypoints.

The three runtime cycles that originally held `no-circular` at `warn` were
cleared in AP-377. Each was closed by an `import type` back-edge, so the fix in
every case was to move the shared type into a dependency-free leaf module both
sides import — no runtime restructuring:

- `packages/worker-runtime` — registrar type surface (`AuthResolver`,
  `GuardState`, `Handler`, `HeaderGuardState`, `RegistrarDeps`, …) extracted to
  `registrar-types.ts`; `registrar.ts` re-exports it for the public API.
- `packages/rotation` — versioned-secret shapes extracted to
  `versioned-secret.ts`; `automation.ts` re-exports them.
- `apps/cli` — `GlobalFlags` extracted to a zero-import `global-flags.ts`, so
  `update-check.ts` no longer imports the `index.ts` entrypoint for its type.

The TanStack `apps/web` `router.tsx` ↔ `routeTree.gen.ts` cycle is
framework-generated and excluded via the `*.gen.ts` rule; it is not a defect.

## How to ratchet

1. Clear an advisory rule's findings (the way AP-377 broke the runtime cycles
   to promote `no-circular`, and the follow-up cleared the orphan false
   positives to promote `no-orphans`).
2. Re-measure: `pnpm depcruise` (or `pnpm depcruise --output-type err-long`
   for the full path of each finding; `pnpm depcruise --output-type dot` for
   a Graphviz graph).
3. Flip that rule's `severity` from `warn` to `error` in
   `.dependency-cruiser.cjs` and update its comment.
4. Update this file. When all rules are blocking and stable, this file can be
   trimmed to just the rule table.

## Candidate future rules (not yet added)

Deliberately deferred so the first landing stays defensible (AP-372 "do not
invent broad architecture rules not backed by docs"). Add incrementally, each in
its own change so any violations are reviewed in isolation:

- The full per-Worker "must NOT own" matrix from `docs/specs/architecture.md`
  (e.g. `web` must not import Postgres/R2/KV directly; `mcp` no business writes).
- Shared-package direction rules (UI/brand/config/contracts/tokens should not
  grow reverse dependencies on higher layers). Clean today, but encoding it is
  speculative until a near-miss justifies the rule.
