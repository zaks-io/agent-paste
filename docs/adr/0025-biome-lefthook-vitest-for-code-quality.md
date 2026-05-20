# Biome, Lefthook, and Vitest for Code Quality

Code quality enforcement will use Biome for lint and formatting, Lefthook for git hooks, and Vitest for tests. Biome replaces a combined ESLint and Prettier setup so one fast tool handles both lint and format across the monorepo. Lefthook runs hooks in parallel with first-class staged-file filtering. Worker tests run on Vitest with `@cloudflare/vitest-pool-workers` so they exercise real Cloudflare bindings rather than mocks.

## Consequences

- ADR 0008's `eslint-config` shared package is dropped from the example list of boundary-enforcing packages. Biome configuration lives in `biome.json` at the repo root with per-package overrides where needed.
- Lefthook configuration lives in `lefthook.yml` at the repo root. Hooks are heavy: pre-commit runs `biome check --write --staged`, `gitleaks protect --staged`, and `turbo run typecheck --filter=...[origin/main]`; pre-push runs `turbo run test --filter=...[origin/main]`.
- `--no-verify` is an accepted escape hatch. CI is the enforcement gate; hooks are guidance.
- Build is never run in local hooks. CI owns that.
- Worker apps use `@cloudflare/vitest-pool-workers` so tests run under `workerd` with real R2, queue, KV, and D1 bindings. The CLI and shared packages use plain Vitest.
- Test files are colocated with source (`src/foo.ts` next to `src/foo.test.ts`).
