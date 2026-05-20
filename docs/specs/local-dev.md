# Local Development Spec

This spec defines how the implementation should make the repo runnable. It is intentionally a target state; some commands will not work until the corresponding apps are implemented.

## Prerequisites

- Node.js 24 LTS. Use a Node version manager that reads the repo-level `.nvmrc`; CI resolves that major line with `check-latest` so it runs on the latest 24.x LTS patch.
- `pnpm`.
- Docker for local Postgres.
- `wrangler` authenticated for remote preview/deploy work.
- Auth0 development tenant configuration.

## Initial Setup

```sh
pnpm install
pnpm check
```

Dependency installation uses the root `pnpm-workspace.yaml` catalog. The catalog is intentionally conservative and should be refreshed deliberately during implementation.

## Turborepo Cache

Turbo task caching is enabled locally and in CI. The root `turbo.json` uses strict environment mode, signed remote cache artifacts, a minimum 32-byte signing key, and global dependency inputs for Node, pnpm, TypeScript, and environment-file changes.

CI requires:

- `TURBO_TOKEN` as a GitHub secret.
- `TURBO_TEAM` as a GitHub repository or environment variable.
- `TURBO_REMOTE_CACHE_SIGNATURE_KEY` as a GitHub secret shared with local development.

GitHub Actions also restores `.turbo/cache` through `actions/cache`; on Blacksmith runners, that cache is served by Blacksmith's colocated cache backend.

## Planned Commands

| Command | Purpose |
|---|---|
| `pnpm check` | Run format/lint/typecheck/test once all apps exist. |
| `pnpm hooks:install` | Install Lefthook git hooks. |
| `pnpm typecheck` | Typecheck packages and apps. |
| `pnpm test` | Run Vitest suites. |
| `pnpm --filter @agent-paste/contracts typecheck` | Validate contract package. |
| `pnpm --filter @agent-paste/db migrate:local` | Apply local Drizzle migrations. |
| `pnpm --filter @agent-paste/db seed:local` | Seed local dev workspace. |
| `pnpm --filter @agent-paste/api dev` | Run `api` Worker through Wrangler. |
| `pnpm --filter @agent-paste/upload dev` | Run `upload` Worker through Wrangler. |
| `pnpm --filter @agent-paste/content dev` | Run `content` Worker through Wrangler. |
| `pnpm --filter @agent-paste/jobs dev` | Run queue/cron Worker through Wrangler. |
| `pnpm --filter @agent-paste/web dev` | Run web Worker through TanStack Start/Wrangler. |
| `pnpm --filter @agent-paste/mcp dev` | Run MCP Worker through Wrangler. |
| `pnpm --filter agent-paste dev -- publish ./example` | Exercise CLI against local base URLs. |
| `pnpm dev:all` | Run `api`, `upload`, `content`, and `jobs` in one Wrangler invocation with a shared `--persist-to` directory. Required for any path that crosses Cloudflare Queues or shared KV/R2 state. |

## Multi-Worker Dev and Queues

The individual `pnpm --filter @agent-paste/{app} dev` commands run one Worker in isolation. That is fine when the work under test does not cross a Worker boundary — for example, editing an `api` route handler in isolation or iterating on `web` UI. It is not fine for any path that crosses Cloudflare Queues or shared KV/R2 state, because:

- A queue producer running in one `wrangler dev` process does not deliver messages to a consumer running in a different `wrangler dev` process. Cloudflare's local queue runtime fans out only inside the same Wrangler invocation. This catches developers iterating on `jobs` while running `api` separately and silently seeing zero messages.
- Each `wrangler dev` invocation gets its own local persistence directory unless `--persist-to` is set to a shared path. Without a shared directory, the local KV namespace and R2 bucket bindings in `api`, `upload`, `content`, and `jobs` resolve to different on-disk stores, so a denylist write from `api` is invisible to `content` and an R2 PUT from `upload` is invisible to `content` and `jobs`.

When developing any path involving `jobs` (publish → finalize → bundle generation, retention sweeps, deletion byte purge, safety scanning) or any cross-Worker state (denylist writes from `api` read by `content`), launch the producers and consumer in one Wrangler invocation with a shared persist-to directory:

```sh
wrangler dev \
  -c apps/api/wrangler.toml \
  -c apps/upload/wrangler.toml \
  -c apps/jobs/wrangler.toml \
  -c apps/content/wrangler.toml \
  --persist-to .wrangler/state
```

The root `pnpm dev:all` script wraps this command. `web` and `mcp` can run alongside on separate ports either inside the same invocation or as additional service-binding targets; their bindings are not on the publish hot path.

The `.wrangler/state` directory is per-developer and gitignored. Resetting local R2 and KV state means removing that directory; Postgres state is reset via `pnpm --filter @agent-paste/db migrate:local` followed by `seed:local`.

## Local Services

The implementation should add `docker-compose.yml` with:

- Postgres.
- Optional local observability sink if needed later.

Cloudflare bindings should be exercised through Wrangler local dev where practical. Local R2/KV behavior can use Wrangler's local persistence.

## Environment Files

Commit examples, not secrets:

- `.env.example`
- `apps/api/.dev.vars.example`
- `apps/upload/.dev.vars.example`
- `apps/content/.dev.vars.example`
- `apps/jobs/.dev.vars.example`
- `apps/web/.dev.vars.example`
- `apps/mcp/.dev.vars.example`

Required values:

- Auth0 domain, audiences, and client ids.
- Postgres URL or Hyperdrive local equivalent.
- Content gateway signing keys by kid.
- Access Link signing keys by kid.
- API Key pepper.
- Web session seal key.
- Operator email allowlist.

## Local Smoke Test Target

The first local vertical slice is complete when:

1. A seeded Workspace and API Key exist.
2. CLI can publish a folder using `AGENT_PASTE_API_KEY`.
3. Publish returns Private Link, Revision Link, Agent View link, and pending Bundle.
4. Access Link resolve returns Agent View with `content_prefix`.
5. Content route serves the entrypoint under the content origin.
6. Revoking the Access Link stops a fresh resolve.
