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

| Command                                                                                        | Purpose                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                                                   | Run the repo check pipeline through Turborepo.                                                                                                      |
| `pnpm dev:all`                                                                                 | Build and run the local MVP API, Upload, and Content harness on ports `8787`, `8788`, and `8789`.                                                   |
| `pnpm dev:apex`                                                                                | Start the apex marketing preview server on port `5174` with Vite hot reload and preview-shaped links.                                               |
| `pnpm smoke:local`                                                                             | Build, start the local harness, drive publish/read/delete via smoke harness, run `publish --ephemeral` + claim redemption, and stop the harness.    |
| `pnpm smoke:preview:ephemeral` / `pnpm smoke:production:ephemeral` / `pnpm smoke:pr:ephemeral` | Hosted ephemeral publish smoke against deployed Workers (skips clearly when `EPHEMERAL_POW_SECRET` is absent). See `docs/ops/status/hosted-ops.md`. |
| `pnpm hooks:install`                                                                           | Install Lefthook git hooks.                                                                                                                         |
| `pnpm typecheck`                                                                               | Typecheck packages and apps.                                                                                                                        |
| `pnpm test`                                                                                    | Run Vitest suites.                                                                                                                                  |
| `pnpm --filter @agent-paste/api test`                                                          | Run API tests, including the in-process local MVP vertical slice.                                                                                   |
| `pnpm --filter @agent-paste/api dev`                                                           | Run the API Worker through Wrangler once Wrangler config/bindings exist.                                                                            |
| `pnpm --filter @agent-paste/upload dev`                                                        | Run the Upload Worker through Wrangler once Wrangler config/bindings exist.                                                                         |
| `pnpm --filter @agent-paste/content dev`                                                       | Run the Content Worker through Wrangler once Wrangler config/bindings exist.                                                                        |
| `pnpm cli:dev whoami --json`                                                                   | Exercise the CLI against `AGENT_PASTE_API_URL`.                                                                                                     |
| `pnpm cli:dev publish examples/local-harness/site --title "Local harness" --json`              | Publish the local harness through the configured API and upload URLs.                                                                               |
| `pnpm --filter @agent-paste/mcp test`                                                          | Run MCP Worker unit tests (transport, auth, tools).                                                                                                 |
| `pnpm smoke:mcp`                                                                               | Build and run local MCP smoke (OAuth + publish/read/delete through MCP tools).                                                                      |

See [`docs/ops/runbook-mcp-hosts.md`](../ops/runbook-mcp-hosts.md) for hosted MCP URLs, host onboarding, and preview/production smoke commands.

## Local MVP Test

The complete local CLI smoke test is:

```sh
pnpm smoke:local
```

It starts the local harness, creates a Workspace and API Key through the smoke harness, runs `agent-paste whoami`, publishes `examples/local-harness/site`, fetches the returned `artifact_url`, fetches the returned `revision_content_url`, fetches the returned `agent_view_url`, deletes the Artifact and verifies purge, then publishes `examples/local-harness/ephemeral-site` with `agent-paste publish --ephemeral`, checks ephemeral policy boundaries (noindex, script-disabled CSP, write allowance, Claim Token isolation), and redeems the Claim Token through the local WorkOS stub into a member workspace.

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
export AGENT_PASTE_API_URL=http://127.0.0.1:8787
export AGENT_PASTE_SMOKE_HARNESS_SECRET=local-smoke-harness-secret

# Provision a workspace + API key through the non-production smoke harness:
curl -fsS -X POST http://127.0.0.1:8787/__test__/provision-smoke \
  -H "Authorization: Bearer ${AGENT_PASTE_SMOKE_HARNESS_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"email":"local@example.com","workspace_name":"Local","key_name":"local"}'

export AGENT_PASTE_API_KEY=<api_key_secret from response>
pnpm cli:dev whoami --json
pnpm cli:dev publish "$(pwd)/examples/local-harness/site" --json
```

Or run `pnpm smoke:local`, which performs the full harness flow automatically.

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

`docker-compose.yml` provides Postgres for the persistent local/CI path:

```sh
docker compose up -d postgres
docker compose ps
```

Use this owner URL when running migrations against the local container:

```sh
DATABASE_URL=postgres://agent_paste:agent_paste@127.0.0.1:5432/agent_paste
```

Apply migrations with an `app_role` runtime password, then run the local harness
against the runtime role:

```sh
DATABASE_URL=postgres://agent_paste:agent_paste@127.0.0.1:5432/agent_paste \
DATABASE_RUNTIME_ROLE_PASSWORD=agent-paste-local-app-role \
pnpm --filter @agent-paste/db migrate

AGENT_PASTE_LOCAL_DATABASE_BACKEND=postgres \
AGENT_PASTE_LOCAL_DATABASE_URL=postgres://app_role:agent-paste-local-app-role@127.0.0.1:5432/agent_paste \
pnpm dev:all
```

CI uses the same shape via `pnpm smoke:ci:postgres`: one job-local Postgres
container, migrations as the owner URL, then the CLI publish smoke through the
local harness using `app_role` and RLS.

## Environment Files

Commit examples, not secrets:

- `.env.example`
- `apps/api/.dev.vars.example`
- `apps/upload/.dev.vars.example`
- `apps/content/.dev.vars.example`

Shared CLI values:

- `AGENT_PASTE_API_URL`
- `AGENT_PASTE_API_KEY`

Worker values currently read by runtime code:

- API: `SMOKE_HARNESS_SECRET` (non-production smoke only), `CONTENT_BASE_URL`, `CLEANUP_BATCH_SIZE`
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
4. Publish returns `artifact_id`, `revision_id`, `artifact_url`, `revision_content_url`, `agent_view_url`, and `expires_at`.
5. `artifact_url` opens the authenticated Artifact detail/viewer path in the local harness, while `revision_content_url` serves the entrypoint under the content origin. Public live handoff requires an Access Link Signed URL minted from a Share Link when the surface supports it.
6. `agent_view_url` returns Agent View JSON with full per-file URLs.
7. Admin CLI can list and inspect the artifact.
8. Manual cleanup can dry-run and admin delete invalidates content URLs.
