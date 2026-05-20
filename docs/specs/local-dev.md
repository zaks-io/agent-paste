# Local Development Spec

This spec defines how the implementation should make the repo runnable. It is intentionally a target state; some commands will not work until the corresponding apps are implemented.

## Prerequisites

- Node.js 22 or newer.
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
