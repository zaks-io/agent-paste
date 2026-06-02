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
pnpm setup:codex
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
| [`packages/write-allowance`](./packages/write-allowance) | Implemented           | Per-workspace daily new-Artifact write allowance counters (DO + local memory harness).                                                                                           |
| [`packages/repo-lint`](./packages/repo-lint)             | Tooling               | Repo-wide lint and monorepo policy checks.                                                                                                                                       |
| [`packages/tsconfig`](./packages/tsconfig)               | Tooling               | Placeholder package for shared TypeScript configuration ownership; root `tsconfig.base.json` is currently canonical.                                                             |

## Root Commands

### Setup

| Command              | Purpose                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm setup:codex`   | Prepare a fresh Codex worktree, copy local env files when available, install dependencies, and install hooks. |
| `pnpm hooks:install` | Install Lefthook git hooks.                                                                                   |
| `pnpm prepare`       | Non-interactive hook installer used by package lifecycle; skips in CI or with `SKIP_LEFTHOOK=1`.              |

### Local Development

| Command                  | Purpose                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `pnpm dev:all`           | Build packages and start the local MVP API/upload/content harness. |
| `pnpm cli:dev -- <args>` | Run the local CLI from source after building it.                   |
| `pnpm admin -- <args>`   | Shortcut for `pnpm cli:dev admin`.                                 |
| `pnpm cli:test`          | Run only the CLI test suite.                                       |

### Quality

| Command                  | Purpose                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `pnpm build`             | Run `turbo run build`.                                                                                          |
| `pnpm check`             | Run package `check` tasks where defined.                                                                        |
| `pnpm lint`              | Run `turbo run lint`, including repo policy checks.                                                             |
| `pnpm typecheck`         | Run `turbo run typecheck`.                                                                                      |
| `pnpm test`              | Run `turbo run test`.                                                                                           |
| `pnpm test:scripts`      | Run Vitest tests for root `scripts/` helpers (deploy and queue provisioning).                                   |
| `pnpm test:coverage`     | Run Vitest coverage across workspace projects.                                                                  |
| `pnpm knip`              | Run Knip unused file, dependency, and export checks.                                                            |
| `pnpm format`            | Format code with Biome and Markdown with Prettier.                                                              |
| `pnpm format:code`       | Format non-doc files with Biome.                                                                                |
| `pnpm format:docs`       | Format Markdown files with Prettier.                                                                            |
| `pnpm format:docs:check` | Check Markdown formatting.                                                                                      |
| `pnpm verify`            | Full CI-style local verification: docs format check, Knip, lint, typecheck, tests, OpenAPI check, and DB check. |
| `pnpm ci:check`          | Alias for `pnpm verify`.                                                                                        |

### Contracts and Database

| Command                   | Purpose                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `pnpm openapi:check`      | Verify committed OpenAPI goldens in `packages/contracts/openapi`. |
| `pnpm openapi:write`      | Regenerate OpenAPI goldens.                                       |
| `pnpm migrate:preview`    | Run committed DB migrations against the preview migration URL.    |
| `pnpm migrate:production` | Run committed DB migrations against the production migration URL. |
| `pnpm migrate:live`       | Alias for `pnpm migrate:production`.                              |

### Deploy

| Command                                          | Purpose                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `pnpm bootstrap:preview`                         | Generate/write preview Worker secrets.                                                          |
| `pnpm bootstrap:production`                      | Generate/write production Worker secrets.                                                       |
| `pnpm bootstrap:live`                            | Alias for `pnpm bootstrap:production`.                                                          |
| `pnpm secrets:content-signing:preview`           | Set `CONTENT_SIGNING_SECRET` on preview `api`, `upload`, `content`, and `jobs` Workers.         |
| `pnpm secrets:content-signing:production`        | Set `CONTENT_SIGNING_SECRET` on production `api`, `upload`, `content`, and `jobs` Workers.      |
| `pnpm secrets:content-signing:reset:preview`     | Mint one fresh `CONTENT_SIGNING_SECRET` and pin it across the four preview Workers (fix drift). |
| `pnpm secrets:content-signing:reset:production`  | Same drift reset for production.                                                                |
| `pnpm secrets:upload-signing:preview`            | Set `UPLOAD_SIGNING_SECRET` on the preview `upload` Worker.                                     |
| `pnpm secrets:upload-signing:production`         | Set `UPLOAD_SIGNING_SECRET` on the production `upload` Worker.                                  |
| `pnpm secrets:upload-signing:reset:preview`      | Mint one fresh `UPLOAD_SIGNING_SECRET` and pin it on the preview `upload` Worker (fix drift).   |
| `pnpm secrets:upload-signing:reset:production`   | Same drift reset for production.                                                                |
| `pnpm secrets:stream-internal:preview`           | Set `STREAM_INTERNAL_SECRET` on preview `api` and `stream` Workers only.                        |
| `pnpm secrets:stream-internal:production`        | Set `STREAM_INTERNAL_SECRET` on production `api` and `stream` Workers only.                     |
| `pnpm secrets:stream-internal:reset:preview`     | Mint one fresh `STREAM_INTERNAL_SECRET` and pin it on preview `api` and `stream` (fix drift).   |
| `pnpm secrets:stream-internal:reset:production`  | Same drift reset for production.                                                                |
| `pnpm secrets:artifact-bytes:preview`            | Set `ARTIFACT_BYTES_ENCRYPTION_KEY` on preview `upload`, `content`, and `jobs` Workers only.    |
| `pnpm secrets:artifact-bytes:production`         | Set `ARTIFACT_BYTES_ENCRYPTION_KEY` on production `upload`, `content`, and `jobs` Workers only. |
| `pnpm secrets:rotate:content-signing:preview`    | ADR 0045 overlap rotation for content signing on preview (`--step` required).                   |
| `pnpm secrets:rotate:content-signing:production` | Same for production.                                                                            |
| `pnpm secrets:rotate:upload-signing:preview`     | ADR 0045 overlap rotation for upload signing on preview.                                        |
| `pnpm secrets:rotate:upload-signing:production`  | Same for production.                                                                            |
| `pnpm secrets:rotate:api-key-pepper:preview`     | ADR 0045 overlap rotation for API key pepper on preview.                                        |
| `pnpm secrets:rotate:api-key-pepper:production`  | Same for production.                                                                            |
| `pnpm secrets:rotate:artifact-bytes:preview`     | ADR 0045 overlap rotation for artifact-byte encryption keys on preview.                         |
| `pnpm secrets:rotate:artifact-bytes:production`  | Same for production.                                                                            |
| `pnpm secrets:rotate:workos-api-key:preview`     | Write `WORKOS_API_KEY` to preview `api` then `web` (requires `--value`).                        |
| `pnpm secrets:rotate:workos-api-key:production`  | Same for production.                                                                            |
| `pnpm secrets:rotate:workos-cookie:preview`      | Rotate preview `WORKOS_COOKIE_PASSWORD` on `web`.                                               |
| `pnpm secrets:rotate:workos-cookie:production`   | Same for production.                                                                            |
| `pnpm deploy:preview`                            | Run preview migrations, then deploy `api`, `upload`, `content`, `apex`, and `web` in order.     |
| `pnpm deploy:production`                         | Run production migrations, then deploy `api`, `upload`, `content`, `apex`, and `web` in order.  |
| `pnpm deploy:live`                               | Alias for `pnpm deploy:production`.                                                             |

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
