# agent-paste

Agent-paste is a platform for agents to publish durable, shareable work products as **Artifacts**.

This repository is pre-launch. It is not deployed for general users, but the core hosted Workers, CLI, WorkOS-backed web dashboard surface, shared contracts, database layer, and local/hosted smoke paths are implemented and actively changing.

The public npm package namespace reserved for CLI distribution is `@zaks-io/agent-paste`. The installed command remains `agent-paste`.

This README is the human entry point. Agents should start with [`AGENTS.md`](./AGENTS.md), then follow the reading order it names.

## Source of Truth

- [`docs/ops/project-status.md`](./docs/ops/project-status.md): current implementation state, verified checks, deferred work, and ordered backlog.
- [`CONTEXT.md`](./CONTEXT.md): domain language.
- [`docs/specs/README.md`](./docs/specs/README.md): product/spec reading order.
- [`docs/adr/README.md`](./docs/adr/README.md): architecture decision index and current conflict resolutions.
- [`packages/contracts`](./packages/contracts): canonical Zod schemas, OpenAPI generation, and route registries.
- [`AGENTS.md`](./AGENTS.md): agent operating instructions.

## Prerequisites

- Node from [`.nvmrc`](./.nvmrc) / [`.node-version`](./.node-version).
- Corepack-managed `pnpm` from [`package.json`](./package.json).
- Cloudflare, Neon, WorkOS, and production credentials only for hosted deploy/smoke work.

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

| Workspace                                                | Status                | Purpose                                                                                                                                                                          |
| -------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/apex`](./apps/apex)                               | Implemented           | Marketing surface at `agent-paste.sh`, `/llms.txt`, `/agents.md`, and redirects to `app.agent-paste.sh`.                                                                         |
| [`apps/api`](./apps/api)                                 | Implemented           | Authenticated control-plane Worker, public Agent View, dashboard API, admin/operator routes, cleanup scheduler.                                                                  |
| [`apps/upload`](./apps/upload)                           | Implemented           | Upload-session Worker, signed upload-worker PUT URLs, private R2 writes, finalize flow.                                                                                          |
| [`apps/content`](./apps/content)                         | Implemented           | Isolated untrusted-content Worker with signed content tokens, R2 reads, denylist checks, MIME/CSP/header hardening, and artifact read throttling.                                |
| [`apps/cli`](./apps/cli)                                 | Implemented           | `agent-paste` CLI for login, logout, whoami, and publish.                                                                                                                        |
| [`apps/web`](./apps/web)                                 | Implemented           | TanStack Start dashboard Worker with WorkOS AuthKit, dashboard loaders/mutations, Access Link viewer, and Live Update client proxies.                                            |
| [`apps/jobs`](./apps/jobs)                               | Implemented           | Queue/cron Worker for bundle generation, byte purge, safety scan, and lifecycle discovery.                                                                                       |
| [`apps/stream`](./apps/stream)                           | Implemented           | Live Updates Worker with per-artifact Durable Objects, SSE fan-out, and connection authorization via `api`.                                                                      |
| [`apps/mcp`](./apps/mcp)                                 | Implemented           | OAuth-only hosted MCP Worker: Streamable HTTP transport, WorkOS bearer verification, and the twelve-tool publish/read/links surface over service bindings to `api` and `upload`. |
| [`packages/contracts`](./packages/contracts)             | Implemented           | Zod schemas, route contracts, OpenAPI goldens, ID primitives, and shared wire types.                                                                                             |
| [`packages/worker-runtime`](./packages/worker-runtime)   | Implemented           | Contract-driven Hono registrar, request guard, principal model, errors, and rate-limit helpers.                                                                                  |
| [`packages/db`](./packages/db)                           | Implemented           | Drizzle schema/migrations, Postgres and local repositories, RLS helpers, query objects, and DB checks.                                                                           |
| [`packages/auth`](./packages/auth)                       | Implemented           | WorkOS JWT/JWKS verification, MCP OAuth bearer verification, request/error helpers, and two-layer cached lookup helper.                                                          |
| [`packages/api-client`](./packages/api-client)           | Implemented           | Internal REST client used by the CLI and login key-mint flow.                                                                                                                    |
| [`packages/storage`](./packages/storage)                 | Implemented           | Served content-type allowlist and security-header helpers.                                                                                                                       |
| [`packages/billing`](./packages/billing)                 | Implemented (partial) | Stripe billing sync seam, entitlement projection, and daily reconciliation backstop (ADR 0073/0074); Checkout/webhooks land in AP-5.                                             |
| [`packages/commands`](./packages/commands)               | Implemented           | `runCommand`, idempotency claim/replay, and audit event sequencing helpers.                                                                                                      |
| [`packages/tokens`](./packages/tokens)                   | Implemented           | Shared signed-token codec and token-kind modules for content, Agent View, and upload URLs.                                                                                       |
| [`packages/rotation`](./packages/rotation)               | Implemented           | Tested multi-key and multi-pepper rotation rings and overlap playbooks for ADR 0045.                                                                                             |
| [`packages/config`](./packages/config)                   | Implemented           | Shared constants, storage-path normalization, and expiration helpers.                                                                                                            |
| [`packages/brand`](./packages/brand)                     | Implemented           | Shared design tokens (color ladder, one violet accent, type scale, fonts) plus CSS-vars, `@font-face`, and grain helpers consumed by `apps/web` and `apps/apex`.                 |
| [`packages/write-allowance`](./packages/write-allowance) | Implemented           | Per-workspace daily new-Artifact write allowance counters (DO + local memory harness).                                                                                           |
| [`packages/plans`](./packages/plans)                     | Implemented           | Presentational Plan definitions (name, price, feature copy) for the billing dashboard; allowance bullet sourced from the enforced `config` constants.                            |
| [`packages/repo-lint`](./packages/repo-lint)             | Tooling               | Repo-wide lint and monorepo policy checks.                                                                                                                                       |
| [`packages/tsconfig`](./packages/tsconfig)               | Tooling               | Placeholder package for shared TypeScript configuration ownership; root `tsconfig.base.json` is currently canonical.                                                             |

## Root Commands

### Setup

| Command               | Purpose                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm setup:worktree` | Prepare a fresh git worktree: copy local env files (incl. nested `.dev.vars`) from the main checkout, install dependencies, and install hooks. Aliased as `pnpm setup:codex`. |
| `pnpm hooks:install`  | Install Lefthook git hooks.                                                                                                                                                   |
| `pnpm prepare`        | Non-interactive hook installer used by package lifecycle; skips in CI or with `SKIP_LEFTHOOK=1`.                                                                              |

### Local Development

| Command                  | Purpose                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:web`           | Build packages and start the local API/upload/content/jobs/stream harness plus the web dashboard on `localhost:5173`. |
| `pnpm dev:all`           | Build packages and start only the local MVP API/upload/content/jobs/stream harness.                                   |
| `pnpm cli:dev -- <args>` | Run the local CLI from source after building it.                                                                      |
| `pnpm admin -- <args>`   | Shortcut for `pnpm cli:dev admin`.                                                                                    |
| `pnpm cli:test`          | Run only the CLI test suite.                                                                                          |

### Quality

| Command                  | Purpose                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`             | Run `turbo run build`.                                                                                                                          |
| `pnpm check`             | Run package `check` tasks where defined.                                                                                                        |
| `pnpm lint`              | Run `turbo run lint`, including repo policy checks.                                                                                             |
| `pnpm typecheck`         | Run `turbo run typecheck`.                                                                                                                      |
| `pnpm typecheck:scripts` | Type-check the root `scripts/` decision-logic tier via `tsc` against `tsconfig.scripts.json` (the `@ts-check` files).                           |
| `pnpm test`              | Run `turbo run test`.                                                                                                                           |
| `pnpm test:scripts`      | Run Vitest tests for root `scripts/` helpers (deploy and queue provisioning).                                                                   |
| `pnpm test:coverage`     | Run Vitest coverage across workspace projects.                                                                                                  |
| `pnpm knip`              | Run Knip unused file, dependency, and export checks.                                                                                            |
| `pnpm dupes`             | Run jscpd copy-paste duplication gate over `apps/` and `packages/`.                                                                             |
| `pnpm format`            | Format code with Biome and Markdown with Prettier.                                                                                              |
| `pnpm format:code`       | Format non-doc files with Biome.                                                                                                                |
| `pnpm format:docs`       | Format Markdown files with Prettier.                                                                                                            |
| `pnpm format:docs:check` | Check Markdown formatting.                                                                                                                      |
| `pnpm security:attest`   | Run the release security attestation suite and write scanner reports under `artifacts/security/`.                                               |
| `pnpm verify`            | Full CI-style local verification: docs format check, Knip, duplication, lint, typecheck, tests, scripts typecheck, OpenAPI check, and DB check. |
| `pnpm ci:check`          | Alias for `pnpm verify`.                                                                                                                        |

### Contracts and Database

| Command                   | Purpose                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `pnpm openapi:check`      | Verify committed OpenAPI goldens in `packages/contracts/openapi`. |
| `pnpm openapi:write`      | Regenerate OpenAPI goldens.                                       |
| `pnpm migrate:preview`    | Run committed DB migrations against the preview migration URL.    |
| `pnpm migrate:production` | Run committed DB migrations against the production migration URL. |
| `pnpm migrate:live`       | Alias for `pnpm migrate:production`.                              |

### Deploy

| Command                                                | Purpose                                                                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bootstrap:preview`                               | Generate/write preview Worker secrets.                                                                                                                                                                              |
| `pnpm bootstrap:production`                            | Generate/write production Worker secrets.                                                                                                                                                                           |
| `pnpm bootstrap:live`                                  | Alias for `pnpm bootstrap:production`.                                                                                                                                                                              |
| `node scripts/deploy.mjs <local\|preview\|production>` | One command: bind every secret to its consumer Workers (generate-if-missing or from `PRODUCTION_*`/`PREVIEW_*` env) and deploy. `local` writes a gitignored `.env`. Idempotent; never prints a value. See ADR 0078. |
| `pnpm secrets:local`                                   | Generate independent local-only secrets into a gitignored `.env` for `pnpm dev:all` (alias for `node scripts/deploy.mjs local`). Idempotent; never prints a value.                                                  |
| `pnpm secrets:rotate:content-signing:preview`          | ADR 0045 overlap rotation for content signing on preview (`--step` required).                                                                                                                                       |
| `pnpm secrets:rotate:content-signing:production`       | Same for production.                                                                                                                                                                                                |
| `pnpm secrets:rotate:upload-signing:preview`           | ADR 0045 overlap rotation for upload signing on preview.                                                                                                                                                            |
| `pnpm secrets:rotate:upload-signing:production`        | Same for production.                                                                                                                                                                                                |
| `pnpm secrets:rotate:api-key-pepper:preview`           | ADR 0045 overlap rotation for API key pepper on preview.                                                                                                                                                            |
| `pnpm secrets:rotate:api-key-pepper:production`        | Same for production.                                                                                                                                                                                                |
| `pnpm secrets:rotate:artifact-bytes:preview`           | ADR 0045 overlap rotation for artifact-byte encryption keys on preview.                                                                                                                                             |
| `pnpm secrets:rotate:artifact-bytes:production`        | Same for production.                                                                                                                                                                                                |
| `pnpm secrets:rotate:workos-api-key:preview`           | Write `WORKOS_API_KEY` to preview `api` then `web` (requires `--value`).                                                                                                                                            |
| `pnpm secrets:rotate:workos-api-key:production`        | Same for production.                                                                                                                                                                                                |
| `pnpm secrets:rotate:workos-cookie:preview`            | Rotate preview `WORKOS_COOKIE_PASSWORD` on `web`.                                                                                                                                                                   |
| `pnpm secrets:rotate:workos-cookie:production`         | Same for production.                                                                                                                                                                                                |
| `pnpm deploy:preview`                                  | Run preview migrations, then deploy `api`, `upload`, `content`, `apex`, and `web` in order.                                                                                                                         |
| `pnpm deploy:production`                               | Run production migrations, then deploy `api`, `upload`, `content`, `apex`, and `web` in order.                                                                                                                      |
| `pnpm deploy:live`                                     | Alias for `pnpm deploy:production`.                                                                                                                                                                                 |

### Smoke Tests

| Command                           | Purpose                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm smoke:local`                | Build and run the local publish/content/delete smoke path.                                                            |
| `pnpm smoke:web`                  | Build and run local web API auth/dashboard smoke assertions.                                                          |
| `pnpm smoke:mcp`                  | Build and run local MCP transport + OAuth + publish/read/delete smoke.                                                |
| `pnpm smoke:mcp:preview`          | Build and run hosted preview MCP smoke (optional token for authenticated checks).                                     |
| `pnpm smoke:mcp:production`       | Build and run hosted production MCP smoke (requires explicit approval and token).                                     |
| `pnpm lighthouse:dashboard-a11y`  | Run the local Lighthouse accessibility gate on authenticated `/dashboard` empty chrome (requires `pnpm build` first). |
| `pnpm smoke:preview`              | Build and run hosted preview smoke assertions.                                                                        |
| `pnpm smoke:preview:ephemeral`    | Build and run hosted preview ephemeral publish smoke (skips when `EPHEMERAL_POW_SECRET` is absent).                   |
| `pnpm smoke:production`           | Build and run hosted production smoke assertions.                                                                     |
| `pnpm smoke:production:ephemeral` | Build and run hosted production ephemeral publish smoke (operator-only; optional WorkOS token for claim).             |
| `pnpm smoke:pr`                   | Build and run hosted PR-preview smoke assertions manually using PR workflow-provided URLs.                            |
| `pnpm smoke:pr:ephemeral`         | Build and run hosted PR-preview ephemeral publish smoke (also runs in the PR preview workflow).                       |
| `pnpm smoke:preview:readonly`     | Build and run the credential-free read-only preview smoke ("is it broken right now?"; no secrets, nothing skipped).   |
| `pnpm smoke:prod:readonly`        | Build and run the credential-free read-only production smoke; runs post-deploy in the production workflow.            |

### Hooks

| Command                     | Purpose                                 |
| --------------------------- | --------------------------------------- |
| `pnpm hooks:run:pre-commit` | Run Lefthook pre-commit tasks manually. |
| `pnpm hooks:run:pre-push`   | Run Lefthook pre-push tasks manually.   |

## Package Script Policy

- Code packages with a local `tsconfig.json` provide `build`, `lint`, `test`, `typecheck`, and `check`.
- Deployable Worker packages with `wrangler.jsonc` also provide `dev`, `deploy:preview`, `deploy:production`, `deploy:live`, and `typegen`.
- Metadata/tooling packages that do not compile runtime code provide `lint` and `check`; they do not carry fake no-op `build` or `test` scripts.
- Root scripts orchestrate cross-workspace behavior through Turborepo or repo scripts instead of duplicating package internals.

## Monorepo Maintenance

- pnpm workspaces are limited to `apps/*` and `packages/*`.
- Shared dependency versions live in the pnpm catalog in [`pnpm-workspace.yaml`](./pnpm-workspace.yaml) where centralization is intentional.
- Internal dependencies use `workspace:*` so package boundaries are explicit.
- `nodeLinker=isolated`, `engine-strict=true`, and `minimumReleaseAge=4320` are enforced by CI.
- Turborepo runs with `envMode: "strict"` and signed remote cache artifacts.
- Environment changes that affect tasks must be declared in `turbo.json` task env/pass-through configuration or included in global dependencies.
- Worker runtime bindings live in each app's `wrangler.jsonc`; generated binding types are committed when those configs change.

## Git Hooks

Lefthook is configured at the repo root. `pre-commit` runs Biome on staged files, Prettier on staged Markdown, `gitleaks protect --staged --redact`, and Turbo typecheck for packages affected since `origin/main` with a local `HEAD` fallback. `pre-push` runs `pnpm knip` and `pnpm test:coverage` so dead-code and global coverage checks run before local pushes.

## Security

Report vulnerabilities privately. See [`SECURITY.md`](./SECURITY.md). Do not open public issues for security reports.

## License

Apache License 2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). Copyright 2026 zaks-io.

The source is open under Apache-2.0. The hosted service operated by zaks-io is a separate, commercial offering; this license covers the code, not access to the hosted product.
