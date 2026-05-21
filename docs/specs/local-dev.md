# Local Development Spec

This spec defines how the CLI-first MVP should become runnable. It is a target state; some commands will not work until the corresponding apps are implemented.

## Prerequisites

- Node.js 24 LTS.
- `pnpm`.
- Docker for local Postgres.
- `wrangler` authenticated for Cloudflare preview/deploy work.
- Cloudflare R2/KV resources for preview.
- Cloudflare Hyperdrive configuration for hosted environments.

Auth0 is not required for the MVP public CLI. OAuth is a future phase.

## Initial Setup

```sh
pnpm install
pnpm check
```

Dependency installation uses the root `pnpm-workspace.yaml` catalog. The catalog is intentionally conservative and should be refreshed deliberately during implementation.

## Planned Commands

| Command | Purpose |
|---|---|
| `pnpm check` | Run format/lint/typecheck/test once all apps exist. |
| `pnpm hooks:install` | Install Lefthook git hooks. |
| `pnpm typecheck` | Typecheck packages and apps. |
| `pnpm test` | Run Vitest suites. |
| `pnpm --filter @agent-paste/contracts typecheck` | Validate contract package. |
| `pnpm --filter @agent-paste/db migrate:local` | Apply local Drizzle migrations. |
| `pnpm --filter @agent-paste/db seed:local` | Seed local dev workspace and API key. |
| `pnpm --filter @agent-paste/api dev` | Run `api` Worker through Wrangler. |
| `pnpm --filter @agent-paste/upload dev` | Run `upload` Worker through Wrangler. |
| `pnpm --filter @agent-paste/content dev` | Run `content` Worker through Wrangler. |
| `pnpm --filter agent-paste dev -- whoami` | Exercise public CLI against local base URLs. |
| `pnpm --filter agent-paste dev -- publish ./examples/site` | Exercise publish against local base URLs. |
| `pnpm admin workspace list` | Exercise admin CLI against configured admin base URL. |
| `pnpm dev:all` | Run `api`, `upload`, and `content` in one Wrangler invocation with a shared `--persist-to` directory. |

Future commands for `jobs`, `web`, and `mcp` should be added only when those phases begin.

## Multi-Worker Dev

The MVP publish path crosses three Workers and shared local state:

- `upload` writes R2 objects.
- `api` writes metadata and denylist keys.
- `content` reads R2 objects and denylist keys.

Each `wrangler dev` invocation gets its own local persistence directory unless `--persist-to` is shared. For any publish/read/delete path, launch the Workers in one Wrangler invocation with shared persistence:

```sh
wrangler dev \
  -c apps/api/wrangler.jsonc \
  -c apps/upload/wrangler.jsonc \
  -c apps/content/wrangler.jsonc \
  --persist-to .wrangler/state
```

The root `pnpm dev:all` script should wrap this command.

The `.wrangler/state` directory is per-developer and gitignored. Resetting local R2 and KV state means removing that directory. Postgres state is reset through the local Drizzle migration and seed commands.

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

Required values:

- Postgres URL or Hyperdrive local equivalent.
- R2 bucket binding.
- KV denylist binding.
- Content token signing keys by kid.
- Agent View token signing keys by kid.
- API key pepper.
- Admin token hash or verification secret.
- Public base URLs for `api`, `upload`, and `content`.

Future Auth0, web session, MCP, queue, and Access Link settings should not be required for the MVP local smoke test.

## Local Smoke Test Target

The first local vertical slice is complete when:

1. A seeded Workspace and API Key exist.
2. `agent-paste whoami` succeeds using `AGENT_PASTE_API_KEY`.
3. CLI can publish a folder with `index.html`.
4. Publish returns `artifact_id`, `revision_id`, `view_url`, `agent_view_url`, and `expires_at`.
5. `view_url` serves the entrypoint under the content origin.
6. `agent_view_url` returns Agent View JSON with full per-file URLs.
7. Admin CLI can list and inspect the artifact.
8. Manual cleanup can expire/delete eligible artifacts.
