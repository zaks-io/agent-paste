# Local Development

This spec defines the local setup for the CLI-first product. Two local paths are supported: a fast Node harness with in-memory Cloudflare stand-ins, and the Cloudflare runtime described below with persistent local Postgres, R2, KV, queues, Durable Objects, and native rate limits. Neither path requires hosted credentials.

## Prerequisites

- Node.js 24 LTS.
- `pnpm`.
- Docker for local Postgres when working on the persistent path.
- The lockfile-pinned `wrangler`, installed with the workspace dependencies.

The quick local path uses a mock WorkOS flow through `pnpm cli:dev login`; no
real WorkOS project is required for the in-memory harness.

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

| Command                                                                                        | Purpose                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check`                                                                                   | Run the repo check pipeline through Turborepo.                                                                                                   |
| `pnpm dev:all`                                                                                 | Build and run the local MVP API, Upload, and Content harness on ports `8787`, `8788`, and `8789`.                                                |
| `pnpm dev:apex`                                                                                | Start the apex marketing preview server on port `5174` with Vite hot reload and preview-shaped links.                                            |
| `pnpm smoke:local`                                                                             | Build, start the local harness, drive publish/read/delete via smoke harness, run `publish --ephemeral` + claim redemption, and stop the harness. |
| `pnpm smoke:preview:ephemeral` / `pnpm smoke:production:ephemeral` / `pnpm smoke:pr:ephemeral` | Hosted ephemeral publish smoke against deployed Workers. See `docs/ops/status/hosted-ops.md`.                                                    |
| `pnpm hooks:install`                                                                           | Install Lefthook git hooks.                                                                                                                      |
| `pnpm typecheck`                                                                               | Typecheck packages and apps.                                                                                                                     |
| `pnpm test`                                                                                    | Run Vitest suites.                                                                                                                               |
| `pnpm --filter @agent-paste/api test`                                                          | Run API tests, including the in-process local MVP vertical slice.                                                                                |
| `pnpm --filter @agent-paste/api dev`                                                           | Run the API Worker alone through Wrangler; use `dev:cloudflare` for complete local bindings.                                                     |
| `pnpm --filter @agent-paste/upload dev`                                                        | Run the Upload Worker alone through Wrangler; use `dev:cloudflare` for complete local bindings.                                                  |
| `pnpm --filter @agent-paste/content dev`                                                       | Run the Content Worker alone through Wrangler; use `dev:cloudflare` for shared local storage.                                                    |
| `pnpm cli:dev whoami --json`                                                                   | Exercise the CLI against `AGENT_PASTE_API_URL`.                                                                                                  |
| `pnpm cli:dev publish examples/local-harness/site --title "Local harness" --json`              | Publish the local harness through the configured API and upload URLs.                                                                            |
| `pnpm --filter @agent-paste/mcp test`                                                          | Run MCP Worker unit tests (transport, auth, tools).                                                                                              |
| `pnpm smoke:mcp`                                                                               | Build and run local MCP smoke (OAuth + publish/read/delete through MCP tools).                                                                   |

See [`docs/ops/runbook-mcp-hosts.md`](../ops/runbook-mcp-hosts.md) for hosted MCP URLs, host onboarding, and preview/production smoke commands.

## Local MVP Test

The complete local CLI smoke test is:

```sh
pnpm smoke:local
```

It starts the local harness, signs the CLI in through the mock WorkOS flow, runs
`agent-paste whoami`, publishes `examples/local-harness/site`, verifies the
returned `url`, deletes the Artifact and verifies purge, then publishes
`examples/local-harness/ephemeral-site` with `agent-paste publish --ephemeral`,
checks ephemeral policy boundaries (noindex, Artifact CSP, write
allowance, Claim Token isolation), and redeems the Claim Token through the local
WorkOS stub into a member workspace.

The faster in-process Worker vertical slice is:

```sh
pnpm --filter @agent-paste/api test -- src/local-mvp.test.ts
```

That test launches the API, Upload, and Content handlers directly with
in-memory DB/R2/KV stand-ins. It covers workspace credential creation,
upload-session creation, file PUT, finalize, Agent View JSON, and content
serving without requiring Cloudflare resources or Postgres.

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

pnpm cli:dev login
pnpm cli:dev whoami --json
pnpm cli:dev publish "$(pwd)/examples/local-harness/site" --json
```

Or run `pnpm smoke:local`, which performs the full harness flow automatically.

## Local Cloudflare Runtime

```sh
# In a fresh checkout, select the pinned runtime and install dependencies first.
source "$HOME/.nvm/nvm.sh" --no-use
nvm install
nvm use
pnpm install --frozen-lockfile --strict-peer-dependencies

pnpm dev:cloudflare
```

The launcher builds the workspace with Turbo concurrency 2, rebuilds the Web
output in the current worktree, starts the Compose Postgres service, applies
migrations as the owner, and connects Workers through local Hyperdrive using
`app_role` and RLS. Postgres listens only on `127.0.0.1:5432`.

| Surface   | Local URL               |
| --------- | ----------------------- |
| Dashboard | `http://localhost:5173` |
| Marketing | `http://127.0.0.1:5174` |
| API       | `http://127.0.0.1:8787` |
| Upload    | `http://127.0.0.1:8788` |
| Content   | `http://127.0.0.1:8789` |
| Jobs      | `http://127.0.0.1:8790` |
| MCP       | `http://127.0.0.1:8792` |

Ports `8799` (local gateway) and `18791` (WorkOS fixture) are also required.
The launcher fails on occupied ports; it does not stop someone else's server.
All listeners bind loopback. Ctrl-C stops the launcher and its Workers. Postgres
and its named volume remain available for the next run.

Dashboard sign-in installs an encrypted fixture session for a local developer.
API and MCP verify fixture JWT signatures against the local WorkOS JWKS server;
this exercises their normal authentication paths without a real WorkOS project.
The fixture is not an implementation of WorkOS OAuth, device login, refresh, or
logout. Sessions expire after 24 hours and are replaced on launcher restart.

Independent local secrets, generated configs, fixture credentials, and
Cloudflare state live under the gitignored `.wrangler/local-cloudflare/`.
The launcher does not load project dotenv files or inherit hosted credentials.
Keep this directory private. R2, KV, and Durable Objects persist in its `state/`
subdirectory; Postgres persists in the Compose named volume. Preserve secrets
when retaining encrypted data. Removing secrets alone makes retained bytes and
credentials unreadable.

The API, Upload, Content, Jobs, MCP, and Web Workers share one Wrangler runtime.
Small loopback HTTP proxies select each Worker through service bindings. The
marketing Worker runs separately because the pinned Miniflare version shares
one static-asset disk service across Workers. Auxiliary rate-limit checks use
native bindings on the primary Worker through RPC because Wrangler 4.94 strips
rate-limit bindings from auxiliary Workers. These checks are not disabled.

This follows Cloudflare's [multi-Worker development model](https://developers.cloudflare.com/workers/development-testing/multi-workers/)
and [local Hyperdrive configuration](https://developers.cloudflare.com/hyperdrive/configuration/local-development/).
The generated Web config retains Vite's `no_bundle` and module rules; rebundling
its serialized callbacks introduces helpers that break browser hydration.

In a second terminal, run:

```sh
pnpm smoke:local:cloudflare
```

The smoke requires the running local fleet. It creates isolated test Workspaces
and CLI configuration, then checks CLI auth, publish/read/revise/delete,
queue-generated zip downloads, denylist invalidation, queue-driven byte purge,
ephemeral provisioning and claim, native Durable Objects, security headers, MCP
OAuth and named Worker RPC, dashboard authentication and static assets, and the
marketing Worker. It never prints credentials or bearer URLs.

For manual CLI work, configure both local endpoints:

```sh
export AGENT_PASTE_API_URL=http://127.0.0.1:8787
export AGENT_PASTE_UPLOAD_URL=http://127.0.0.1:8788
```

Create an API key in the local dashboard and supply it through
`AGENT_PASTE_API_KEY`. A missing Upload override otherwise selects the CLI's
hosted Upload default. Use an isolated `XDG_CONFIG_HOME` for accountless tests
so existing CLI credentials cannot participate.

### Sandbox Previews

For a browser outside the sandbox, set the public local origins before starting:

```sh
AGENT_PASTE_LOCAL_WEB_URL=https://<hostname>.tail4068ec.ts.net:5173 \
AGENT_PASTE_LOCAL_CONTENT_URL=https://<hostname>.tail4068ec.ts.net:8789 \
pnpm dev:cloudflare
```

Then open HTTPS mappings with `sbx-preview open 5173`,
`sbx-preview open 8789`, and optionally `sbx-preview open 5174` from the worktree.
Use the full URLs from `sbx-preview list`. The T3 collaborative browser runs on
the desktop; if its environment-port target resolves to desktop localhost,
navigate directly to the sandbox's HTTPS URL.

### Local Fidelity Boundaries

- Workerd emulates Cloudflare locally. This is not a replica of Cloudflare's
  global network, cache, WAF, or distributed rate-limit behavior.
- Local publishing uses signed exact-Revision content URLs, as permitted by this
  spec. Wildcard capability DNS and TLS are not configured. Revisions return new
  local signed URLs, and a pre-claim signed URL retains its restricted policy.
  Hosted capability URLs keep one URL and update their policy after claim.
- WorkOS identity is a fixture. Test real OAuth, device login, refresh, and logout
  in an authorized hosted test environment.
- Workers AI is omitted because inference is remote. Built-in safety scanning
  and ephemeral script detection still run locally.
- Billing is off. Stripe Checkout, Portal, webhooks, Cloudflare Access operator
  identity, and hosted analytics delivery are not validated by the local smoke.
- Queue delivery is local. Cron discovery can be invoked through Wrangler's
  scheduled-event testing endpoint; actual hosted scheduling is not simulated.
- The retired Stream Worker is not part of this local fleet.

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

Shared local values:

- `AGENT_PASTE_API_URL`

Worker values currently read by runtime code:

- API: `SMOKE_HARNESS_SECRET` (non-production smoke only), `CONTENT_BASE_URL`, `CLEANUP_BATCH_SIZE`
- Upload: `UPLOAD_BASE_URL`, `UPLOAD_SIGNING_SECRET`, `UPLOAD_URL_TTL_SECONDS`
- Content: `CONTENT_SIGNING_SECRET`

Worker bindings currently expected from runtime wiring:

- API: `AUTH`, `DB`
- Upload: `AUTH`, `DB`, `ARTIFACTS`
- Content: `ARTIFACTS`, `DENYLIST`

The per-Worker examples are not sufficient to wire a complete local fleet.
Use `dev:cloudflare` for database, shared storage, queue, and authentication wiring. The local env helper
generates `AGENT_PASTE_API_KEY_PEPPER`; the local dev server maps it to
`API_KEY_PEPPER_V1` for Worker runtime compatibility.

Future WorkOS, web session, MCP, and queue settings should not be required for the MVP local smoke test.

## Local Smoke Test Target

The first local vertical slice is complete when:

1. A Workspace and local CLI credential can be created locally.
2. `agent-paste whoami` succeeds after `pnpm cli:dev login`.
3. CLI can publish a folder with `index.html`.
4. Publish prints one no-login `url` as `View`; there is no sharing follow-up.
5. CLI JSON output includes `schema_version`, `artifact_id`, `revision_id`,
   `title`, `url`, `expires_at`, and `upload_stats`. Ephemeral JSON also includes
   separate provisioning and claim fields.
6. Hosted preview and production use the capability hostname. Local development
   may use the signed exact-Revision fallback because wildcard DNS does not exist
   on localhost.
7. Admin CLI can list and inspect the Artifact.
8. Manual cleanup can dry-run and admin delete invalidates content URLs.
