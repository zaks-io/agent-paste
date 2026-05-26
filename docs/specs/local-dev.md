# Local Development

This spec defines the local setup for the CLI-first MVP. The repo currently has a runnable local harness that composes the API, Upload, and Content Workers in one Node process with shared in-memory DB/R2/KV stand-ins. Persistent Postgres and Wrangler multi-worker wiring remain local targets for the hosted implementation path.

## Prerequisites

- Node.js 24 LTS.
- `pnpm`.
- Docker for local Postgres when working on the persistent path.
- `wrangler` for Worker dev once per-app Wrangler config is added.

WorkOS is not required for the MVP public CLI. OAuth is a later phase.

## Initial Setup

```sh
pnpm install
pnpm check
```

Dependency installation uses the root `pnpm-workspace.yaml` catalog. The catalog is intentionally conservative and should be refreshed deliberately during implementation.

Copy the shared CLI environment example when you want a shell preloaded for the local harness:

```sh
cp .env.example .env
set -a
. ./.env
set +a
```

Copy Worker-specific examples only for the Workers you are launching:

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/upload/.dev.vars.example apps/upload/.dev.vars
cp apps/content/.dev.vars.example apps/content/.dev.vars
```

Do not commit real `.env` or `.dev.vars` files.

## Current Commands

| Command                                                                                    | Purpose                                                                                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `pnpm check`                                                                               | Run the repo check pipeline through Turborepo.                                                         |
| `pnpm dev:all`                                                                             | Build and run the local MVP API, Upload, and Content harness on ports `8787`, `8788`, and `8789`.      |
| `pnpm smoke:local`                                                                         | Build, start the local harness, drive the CLI through publish/read/admin/delete, and stop the harness. |
| `pnpm hooks:install`                                                                       | Install Lefthook git hooks.                                                                            |
| `pnpm typecheck`                                                                           | Typecheck packages and apps.                                                                           |
| `pnpm test`                                                                                | Run Vitest suites.                                                                                     |
| `pnpm --filter @agent-paste/api test`                                                      | Run API tests, including the in-process local MVP vertical slice.                                      |
| `pnpm --filter @agent-paste/api dev`                                                       | Run the API Worker through Wrangler once Wrangler config/bindings exist.                               |
| `pnpm --filter @agent-paste/upload dev`                                                    | Run the Upload Worker through Wrangler once Wrangler config/bindings exist.                            |
| `pnpm --filter @agent-paste/content dev`                                                   | Run the Content Worker through Wrangler once Wrangler config/bindings exist.                           |
| `pnpm cli:dev whoami --json`                                                               | Exercise the CLI against `AGENT_PASTE_API_URL`.                                                        |
| `pnpm cli:dev publish examples/local-harness/site --title "Local harness" --ttl 7d --json` | Publish the local harness through the configured API and upload URLs.                                  |
| `pnpm cli:dev admin workspace list --json`                                                 | Exercise admin CLI calls against `AGENT_PASTE_ADMIN_URL`.                                              |
| `pnpm admin workspace list --json`                                                         | Repo-local shorthand for `pnpm cli:dev admin ...`.                                                     |

Future commands for `jobs`, `web`, and `mcp` should be added only when those phases begin.

## Local MVP Test

The complete local CLI smoke test is:

```sh
pnpm smoke:local
```

It starts the local harness, creates a Workspace and API Key through the admin CLI, runs `agent-paste whoami`, publishes `examples/local-harness/site`, fetches the returned `view_url`, fetches the returned `agent_view_url`, lists and inspects the Artifact, runs cleanup dry-run, deletes the Artifact, and verifies the old content URL returns `404`.

The faster in-process Worker vertical slice is:

```sh
pnpm --filter @agent-paste/api test -- src/local-mvp.test.ts
```

That test launches the API, Upload, and Content handlers directly with in-memory DB/R2/KV stand-ins. It covers workspace/key creation, upload-session creation, file PUT, finalize, Agent View JSON, and content serving without requiring Cloudflare resources or Postgres.

Use the broader suite before handing off changes:

```sh
pnpm test
pnpm typecheck
```

## Multi-Worker Dev

The MVP publish path crosses three Workers and shared local state:

- `upload` writes R2 objects.
- `api` writes metadata and denylist keys.
- `content` reads R2 objects and denylist keys.

For the current local MVP, use:

```sh
pnpm dev:all
```

Then, in another shell:

```sh
export AGENT_PASTE_ADMIN_TOKEN=local-admin-token
export AGENT_PASTE_ADMIN_URL=http://127.0.0.1:8787
export AGENT_PASTE_API_URL=http://127.0.0.1:8787
export AGENT_PASTE_UPLOAD_URL=http://127.0.0.1:8788

pnpm admin workspace create local@example.com --name Local --json
pnpm admin key create <workspace-id> --name local --json

export AGENT_PASTE_API_KEY=<secret-from-key-create>
pnpm cli:dev whoami --json
pnpm cli:dev publish examples/local-harness/site --ttl 7d --json
```

When Wrangler config lands, each `wrangler dev` invocation gets its own local persistence directory unless `--persist-to` is shared. For any publish/read/delete path, launch the Workers in one Wrangler invocation with shared persistence:

```sh
wrangler dev \
  -c apps/api/wrangler.jsonc \
  -c apps/upload/wrangler.jsonc \
  -c apps/content/wrangler.jsonc \
  --persist-to .wrangler/state
```

The `.wrangler/state` directory is per-developer and gitignored. Resetting local R2 and KV state means removing that directory.

## Local Services

`docker-compose.yml` provides Postgres for the planned persistent local path:

```sh
docker compose up -d postgres
docker compose ps
```

Use this URL when a package grows a persistent database adapter:

```sh
DATABASE_URL=postgres://agent_paste:agent_paste@127.0.0.1:5432/agent_paste
```

The current checked-in DB package is an in-memory repository used by `pnpm dev:all` and `pnpm smoke:local`. There are no migration or seed scripts yet.

## Environment Files

Commit examples, not secrets:

- `.env.example`
- `apps/api/.dev.vars.example`
- `apps/upload/.dev.vars.example`
- `apps/content/.dev.vars.example`

Shared CLI values:

- `AGENT_PASTE_API_URL`
- `AGENT_PASTE_UPLOAD_URL`
- `AGENT_PASTE_ADMIN_URL`
- `AGENT_PASTE_API_KEY`
- `AGENT_PASTE_ADMIN_TOKEN`

Worker values currently read by runtime code:

- API: `ADMIN_TOKEN`, `CONTENT_BASE_URL`, `CLEANUP_BATCH_SIZE`
- Upload: `UPLOAD_BASE_URL`, `UPLOAD_SIGNING_SECRET`, `UPLOAD_URL_TTL_SECONDS`
- Content: `CONTENT_SIGNING_SECRET`

Worker bindings currently expected from runtime wiring:

- API: `AUTH`, `DB`
- Upload: `AUTH`, `DB`, `ARTIFACTS`
- Content: `ARTIFACTS`, `DENYLIST`

The examples also include planned local names for `DATABASE_URL`, `API_KEY_PEPPER`, R2 bucket, and KV denylist so future binding work has a stable convention.

Future WorkOS, web session, MCP, queue, and Access Link settings should not be required for the MVP local smoke test.

## Local Smoke Test Target

The first local vertical slice is complete when:

1. A Workspace and API Key can be created locally.
2. `agent-paste whoami` succeeds using `AGENT_PASTE_API_KEY`.
3. CLI can publish a folder with `index.html`.
4. Publish returns `artifact_id`, `revision_id`, `view_url`, `agent_view_url`, and `expires_at`.
5. `view_url` serves the entrypoint under the content origin.
6. `agent_view_url` returns Agent View JSON with full per-file URLs.
7. Admin CLI can list and inspect the artifact.
8. Manual cleanup can dry-run and admin delete invalidates content URLs.
