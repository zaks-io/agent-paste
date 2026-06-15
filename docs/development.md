# Development Reference

This is the repo command and workspace reference for contributors and agents.
The root [`README.md`](../README.md) is the public entry point.

## Prerequisites

- Node from [`.nvmrc`](../.nvmrc) / [`.node-version`](../.node-version).
- Corepack-managed `pnpm` from [`package.json`](../package.json).
- Cloudflare, Neon, WorkOS, and production credentials only for hosted deploy or
  smoke work.

For a fresh worktree:

```sh
pnpm setup:worktree
```

For a normal local install:

```sh
corepack enable
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm hooks:install
```

## Workspace Inventory

| Workspace                                                 | Status      | Purpose                                                                                                                                                                          |
| --------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/apex`](../apps/apex)                               | Implemented | Marketing surface at `agent-paste.sh`, `/llms.txt`, `/agents.md`, and redirects to `app.agent-paste.sh`.                                                                         |
| [`apps/api`](../apps/api)                                 | Implemented | Authenticated control-plane Worker, public Agent View, dashboard API, admin/operator routes, cleanup scheduler.                                                                  |
| [`apps/upload`](../apps/upload)                           | Implemented | Upload-session Worker, signed upload-worker PUT URLs, private R2 writes, finalize flow.                                                                                          |
| [`apps/content`](../apps/content)                         | Implemented | Isolated untrusted-content Worker with signed content tokens, R2 reads, denylist checks, MIME/CSP/header hardening, and artifact read throttling.                                |
| [`apps/cli`](../apps/cli)                                 | Implemented | `agent-paste` CLI for login, logout, whoami, publish, and standalone upgrade.                                                                                                    |
| [`apps/web`](../apps/web)                                 | Implemented | TanStack Start dashboard Worker with WorkOS AuthKit, dashboard loaders/mutations, Access Link viewer, and Live Update client proxies.                                            |
| [`apps/jobs`](../apps/jobs)                               | Implemented | Queue/cron Worker for bundle generation, byte purge, safety scan, and lifecycle discovery.                                                                                       |
| [`apps/stream`](../apps/stream)                           | Implemented | Live Updates Worker with per-artifact Durable Objects, SSE fan-out, and connection authorization via `api`.                                                                      |
| [`apps/mcp`](../apps/mcp)                                 | Implemented | OAuth-only hosted MCP Worker: Streamable HTTP transport, WorkOS bearer verification, and the twelve-tool publish/read/links surface over service bindings to `api` and `upload`. |
| [`packages/contracts`](../packages/contracts)             | Implemented | Zod schemas, route contracts, OpenAPI goldens, ID primitives, and shared wire types.                                                                                             |
| [`packages/worker-runtime`](../packages/worker-runtime)   | Implemented | Contract-driven Hono registrar, request guard, principal model, errors, and rate-limit helpers.                                                                                  |
| [`packages/db`](../packages/db)                           | Implemented | Drizzle schema/migrations, Postgres and local repositories, RLS helpers, query objects, and DB checks.                                                                           |
| [`packages/auth`](../packages/auth)                       | Implemented | WorkOS JWT/JWKS verification, MCP OAuth bearer verification, request/error helpers, and two-layer cached lookup helper.                                                          |
| [`packages/api-client`](../packages/api-client)           | Implemented | Internal HTTP client used by the CLI and login credential flow.                                                                                                                  |
| [`packages/storage`](../packages/storage)                 | Implemented | Served content-type allowlist and security-header helpers.                                                                                                                       |
| [`packages/revise-core`](../packages/revise-core)         | Implemented | Transport-agnostic revise engine: literal `applyEdits`, the `RevisionReader` read seam, verified-patch orchestrators, and the unified-diff generator shared by the CLI and MCP.  |
| [`packages/billing`](../packages/billing)                 | Implemented | Stripe billing sync seam, entitlement projection, Checkout, webhooks, Portal, invoices, and daily reconciliation backstop.                                                       |
| [`packages/commands`](../packages/commands)               | Implemented | `runCommand`, idempotency claim/replay, and audit event sequencing helpers.                                                                                                      |
| [`packages/tokens`](../packages/tokens)                   | Implemented | Shared signed-token codec and token-kind modules for content, Agent View, Access Links, and upload URLs.                                                                         |
| [`packages/rotation`](../packages/rotation)               | Implemented | Tested multi-key and multi-pepper rotation rings and overlap playbooks.                                                                                                          |
| [`packages/config`](../packages/config)                   | Implemented | Shared constants, storage-path normalization, and expiration helpers.                                                                                                            |
| [`packages/brand`](../packages/brand)                     | Implemented | Shared design tokens, CSS-var/theme/font emit helpers consumed by `packages/ui`.                                                                                                 |
| [`packages/ui`](../packages/ui)                           | Implemented | Shared design-system stylesheet (generated from `brand` tokens) and React primitives imported by `apps/web` and `apps/apex`, so the two surfaces cannot drift.                   |
| [`packages/write-allowance`](../packages/write-allowance) | Implemented | Per-workspace daily new-Artifact write allowance counters.                                                                                                                       |
| [`packages/plans`](../packages/plans)                     | Implemented | Presentational Plan definitions for the billing dashboard.                                                                                                                       |
| [`packages/repo-lint`](../packages/repo-lint)             | Tooling     | Repo-wide lint and monorepo policy checks.                                                                                                                                       |
| [`packages/tsconfig`](../packages/tsconfig)               | Tooling     | Placeholder package for shared TypeScript configuration ownership; root `tsconfig.base.json` is currently canonical.                                                             |

## Root Commands

### Setup

| Command               | Purpose                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm setup:worktree` | Prepare a fresh git worktree: copy local env files, including nested `.dev.vars`, from the main checkout, install dependencies, and install hooks. Aliased as `pnpm setup:codex`. |
| `pnpm hooks:install`  | Install Lefthook git hooks.                                                                                                                                                       |
| `pnpm prepare`        | Non-interactive hook installer used by package lifecycle; skips in CI or with `SKIP_LEFTHOOK=1`.                                                                                  |

### Local Development

| Command                  | Purpose                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:web`           | Build packages and start the local API/upload/content/jobs/stream harness plus the web dashboard on `localhost:5173`. |
| `pnpm dev:apex`          | Start the apex preview server with Vite hot reload on `localhost:5174`.                                               |
| `pnpm dev:all`           | Build packages and start only the local MVP API/upload/content/jobs/stream harness.                                   |
| `pnpm cli:dev -- <args>` | Run the local CLI from source after building it.                                                                      |
| `pnpm cli:test`          | Run only the CLI test suite.                                                                                          |

### Quality

| Command                     | Purpose                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm build`                | Run `turbo run build`.                                                                                                                                                               |
| `pnpm check`                | Run package `check` tasks where defined.                                                                                                                                             |
| `pnpm lint`                 | Run `turbo run lint`, including repo policy checks.                                                                                                                                  |
| `pnpm typecheck`            | Run `turbo run typecheck`.                                                                                                                                                           |
| `pnpm typecheck:scripts`    | Type-check the root `scripts/` decision-logic tier via `tsc` against `tsconfig.scripts.json`.                                                                                        |
| `pnpm test`                 | Run `turbo run test`.                                                                                                                                                                |
| `pnpm test:scripts`         | Run Vitest tests for root `scripts/` helpers.                                                                                                                                        |
| `pnpm test:coverage`        | Run Vitest coverage across workspace projects.                                                                                                                                       |
| `pnpm test:coverage:strict` | Like `pnpm test:coverage` but `--force`-recomputes every workspace report so a stale turbo cache cannot serve a false green on the repo-wide threshold. Used by the `pre-push` gate. |
| `pnpm knip`                 | Run Knip unused file, dependency, and export checks.                                                                                                                                 |
| `pnpm dupes`                | Run jscpd copy-paste duplication gate over `apps/` and `packages/`.                                                                                                                  |
| `pnpm format`               | Format code with Biome and Markdown with Prettier.                                                                                                                                   |
| `pnpm format:code`          | Format non-doc files with Biome.                                                                                                                                                     |
| `pnpm format:code:check`    | Check non-doc formatting with Biome (no writes; fails if anything is unformatted).                                                                                                   |
| `pnpm format:docs`          | Format Markdown files with Prettier.                                                                                                                                                 |
| `pnpm format:docs:check`    | Check Markdown formatting.                                                                                                                                                           |
| `pnpm verify`               | Full CI-style local verification: code + docs format checks, Knip, duplication, lint, typecheck, tests, scripts typecheck, OpenAPI check, and DB check.                              |
| `pnpm ci:check`             | Alias for `pnpm verify`.                                                                                                                                                             |

### Contracts And Database

| Command                   | Purpose                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `pnpm openapi:check`      | Verify committed OpenAPI goldens in `packages/contracts/openapi`. |
| `pnpm openapi:write`      | Regenerate OpenAPI goldens.                                       |
| `pnpm migrate:preview`    | Run committed DB migrations against the preview migration URL.    |
| `pnpm migrate:production` | Run committed DB migrations against the production migration URL. |
| `pnpm migrate:live`       | Alias for `pnpm migrate:production`.                              |

### Deploy

`deploy:preview` is the one command for preview. It builds (via Turbo, so every
workspace dependency is built in graph order and cached), provisions secrets, and
deploys. Scope it to a single Worker with `--app=<name>`:

```sh
pnpm deploy:preview                    # migrate (if needed) + build + deploy all
pnpm deploy:preview --app=apex         # deploy only apex (the marketing page)
pnpm deploy:preview --app=web,api      # deploy a few Workers
pnpm deploy:preview --no-migrate       # deploy all Workers, skip migrations
```

Migrations run automatically only when the deploy includes a DB-backed Worker
(`api`, `upload`, `jobs`); a scoped deploy of DB-free Workers (`stream`, `content`,
`mcp`, `apex`, `web`) never migrates. Build + deploy is a Turbo task
(`deploy:<target>` dependsOn `build`), so a clean tree builds dependencies in graph
order before `wrangler deploy` runs. Valid `--app` values: `stream`, `api`,
`upload`, `content`, `jobs`, `mcp`, `apex`, `web`. There is no production equivalent
of `--app` — production deploys the full fleet through CI on merge to `main`; do not
deploy production from a laptop.

| Command                                                | Purpose                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bootstrap:preview`                               | Generate/write preview Worker secrets.                                                                                                                                                                                                                                          |
| `pnpm bootstrap:production`                            | Generate/write production Worker secrets.                                                                                                                                                                                                                                       |
| `pnpm bootstrap:live`                                  | Alias for `pnpm bootstrap:production`.                                                                                                                                                                                                                                          |
| `node scripts/deploy.mjs <local\|preview\|production>` | Migrate (when a DB-backed app is in scope), provision secrets, then build + deploy via Turbo. `--app=<name>` scopes preview deploys only; production is full-fleet only. `--no-migrate` skips migrations. `local` writes a gitignored `.env`. Idempotent; never prints a value. |
| `pnpm secrets:local`                                   | Generate independent local-only secrets into a gitignored `.env` for `pnpm dev:all`.                                                                                                                                                                                            |
| `pnpm secrets:rotate:content-signing:preview`          | Overlap rotation for content signing on preview (`--step` required).                                                                                                                                                                                                            |
| `pnpm secrets:rotate:content-signing:production`       | Same for production.                                                                                                                                                                                                                                                            |
| `pnpm secrets:rotate:upload-signing:preview`           | Overlap rotation for upload signing on preview.                                                                                                                                                                                                                                 |
| `pnpm secrets:rotate:upload-signing:production`        | Same for production.                                                                                                                                                                                                                                                            |
| `pnpm secrets:rotate:api-key-pepper:preview`           | Overlap rotation for API key pepper on preview.                                                                                                                                                                                                                                 |
| `pnpm secrets:rotate:api-key-pepper:production`        | Same for production.                                                                                                                                                                                                                                                            |
| `pnpm secrets:rotate:artifact-bytes:preview`           | Overlap rotation for artifact-byte encryption keys on preview.                                                                                                                                                                                                                  |
| `pnpm secrets:rotate:artifact-bytes:production`        | Same for production.                                                                                                                                                                                                                                                            |
| `pnpm secrets:rotate:workos-api-key:preview`           | Write `WORKOS_API_KEY` to preview `api` then `web` (requires `--value`).                                                                                                                                                                                                        |
| `pnpm secrets:rotate:workos-api-key:production`        | Same for production.                                                                                                                                                                                                                                                            |
| `pnpm secrets:rotate:workos-cookie:preview`            | Rotate preview `WORKOS_COOKIE_PASSWORD` on `web`.                                                                                                                                                                                                                               |
| `pnpm secrets:rotate:workos-cookie:production`         | Same for production.                                                                                                                                                                                                                                                            |
| `pnpm deploy:preview`                                  | Deploy to preview: migrate (if a DB-backed Worker is in scope), build + deploy via Turbo. `--app=<name>` deploys one Worker; `--no-migrate` skips migrations.                                                                                                                   |
| `pnpm deploy:production`                               | Deploy the full fleet to production: run production migrations, build + deploy every Worker via Turbo.                                                                                                                                                                          |
| `pnpm deploy:live`                                     | Alias for `pnpm deploy:production`.                                                                                                                                                                                                                                             |
| `pnpm security:attest`                                 | Run the release security attestation gate (`scripts/security-attest.mjs`); writes evidence under `artifacts/security`.                                                                                                                                                          |

### Smoke Tests

| Command                           | Purpose                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm smoke:local`                | Build and run the local publish/content/delete smoke path (also gated in CI `Validate`).                                |
| `pnpm smoke:local:patch`          | Build and run the local ADR 0089 intra-file patch reconstruction smoke (real diff apply + serve byte-exact + conflict). |
| `pnpm smoke:ci:postgres`          | Build, migrate a job-local Postgres database, and run the local CLI smoke through the Postgres/RLS-backed harness.      |
| `pnpm smoke:web`                  | Build and run local web API auth/dashboard smoke assertions.                                                            |
| `pnpm smoke:mcp`                  | Build and run local MCP transport + OAuth + publish/read/delete smoke.                                                  |
| `pnpm smoke:mcp:preview`          | Build and run hosted preview MCP smoke (optional token for authenticated checks).                                       |
| `pnpm smoke:mcp:production`       | Build and run hosted production MCP smoke (requires explicit approval and token).                                       |
| `pnpm lighthouse:dashboard-a11y`  | Run the local Lighthouse accessibility gate on authenticated `/dashboard` empty chrome (requires `pnpm build` first).   |
| `pnpm smoke:preview`              | Build and run hosted preview smoke assertions.                                                                          |
| `pnpm smoke:preview:ephemeral`    | Build and run hosted preview ephemeral publish smoke.                                                                   |
| `pnpm smoke:production`           | Build and run hosted production smoke assertions.                                                                       |
| `pnpm smoke:production:ephemeral` | Build and run hosted production ephemeral publish smoke (operator-only; optional WorkOS token for claim).               |
| `pnpm smoke:pr`                   | Build and run hosted PR-preview smoke assertions manually using PR workflow-provided URLs.                              |
| `pnpm smoke:pr:ephemeral`         | Build and run hosted PR-preview ephemeral publish smoke.                                                                |
| `pnpm smoke:preview:readonly`     | Build and run the credential-free read-only preview smoke.                                                              |
| `pnpm smoke:prod:readonly`        | Build and run the credential-free read-only production smoke.                                                           |

### Hooks

| Command                     | Purpose                                 |
| --------------------------- | --------------------------------------- |
| `pnpm hooks:run:pre-commit` | Run Lefthook pre-commit tasks manually. |
| `pnpm hooks:run:pre-push`   | Run Lefthook pre-push tasks manually.   |

## Package Script Policy

- Code packages with a local `tsconfig.json` provide `build`, `lint`, `test`,
  `typecheck`, and `check`.
- Deployable Worker packages with `wrangler.jsonc` also provide `dev`,
  `deploy:preview`, `deploy:production`, `deploy:live`, and `typegen`.
- Metadata/tooling packages that do not compile runtime code provide `lint` and
  `check`; they do not carry fake no-op `build` or `test` scripts.
- Root scripts orchestrate cross-workspace behavior through Turborepo or repo
  scripts instead of duplicating package internals.

## Monorepo Maintenance

- pnpm workspaces are limited to `apps/*` and `packages/*`.
- Shared dependency versions live in the pnpm catalog in
  [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) where centralization is intentional.
- Internal dependencies use `workspace:*` so package boundaries are explicit.
- `nodeLinker=isolated`, `engine-strict=true`, and `minimumReleaseAge=4320` are
  enforced by CI.
- Turborepo runs with `envMode: "strict"` and signed remote cache artifacts.
- Environment changes that affect tasks must be declared in `turbo.json` task
  env/pass-through configuration or included in global dependencies.
- Worker runtime bindings live in each app's `wrangler.jsonc`; generated binding
  types are committed when those configs change.

## Git Hooks

Lefthook is configured at the repo root. `pre-commit` runs Biome on staged
files, Prettier on staged Markdown, `gitleaks protect --staged --redact`, and
Turbo typecheck for packages affected since `origin/main` with a local `HEAD`
fallback. `pre-push` runs the full `pnpm verify` (format, Knip, duplication,
lint, typecheck, tests, OpenAPI, and DB checks) plus `pnpm test:coverage:strict`
(cache-busted coverage) so a push matches the CI `Validate` gate before it
leaves the machine.

Hooks are installed by `pnpm install` (the `prepare` script) and by
`pnpm setup:worktree`. Installation is skipped only inside GitHub Actions
(`GITHUB_ACTIONS`) or when `SKIP_LEFTHOOK=1` is set; it is **not** skipped in
unattended agent VMs (Cursor / Codex) just because `CI=true`, so remote workers
still get the `pre-push` gate. If a worker bypasses hooks, run `pnpm verify` and
`pnpm test:coverage:strict` by hand before handing off a PR.

## Related Docs

- [`CONTRIBUTING.md`](../CONTRIBUTING.md): contribution workflow.
- [`docs/agents/repo-navigation.md`](./agents/repo-navigation.md): owner lookup map.
- [`scripts/README.md`](../scripts/README.md): script internals and lower-level options.
- [`docs/ops/project-status.md`](./ops/project-status.md): current state and launch gates.
