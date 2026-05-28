# Repo Navigation

This is the fast orientation map for agents that need to find the owning code
or source document quickly. It is not a replacement for the status, spec, ADR,
or domain docs.

## Start Points

Read these first when you are new to the repo or resuming after a long gap:

- [`AGENTS.md`](../../AGENTS.md) - runtime instructions and Cursor Cloud notes.
- [`docs/ops/project-status.md`](../ops/project-status.md) - current state,
  active phase, and ledgers.
- [`CONTEXT.md`](../../CONTEXT.md) - domain language and the app/worker contact
  map.
- [`docs/specs/README.md`](../specs/README.md) - spec reading order.
- [`docs/adr/README.md`](../adr/README.md) - active architecture decisions and
  conflict resolutions.
- [`docs/agents/workflow.md`](./workflow.md) and
  [`docs/agents/skill-usage.md`](./skill-usage.md) - agent workflow and
  repo-local skill choice.

When implementing a Linear issue, also read the issue, every linked doc, and
the README for any app or package you will edit.

## Contact Map

Use this map to find the first files to inspect. The READMEs in each directory
carry the local contract summary and commands.

| Area               | Start Here                                                                                           | Owns                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Product language   | [`CONTEXT.md`](../../CONTEXT.md)                                                                     | Canonical terms, avoided synonyms, app/worker vocabulary, and relationship rules.      |
| Current status     | [`docs/ops/project-status.md`](../ops/project-status.md)                                             | Project snapshot, active phase, deferred work, and status ledger links.                |
| Product specs      | [`docs/specs/README.md`](../specs/README.md)                                                         | User-facing contracts, acceptance criteria, data model, API, web, jobs, and local dev. |
| Architecture       | [`docs/adr/README.md`](../adr/README.md)                                                             | Decision history, current conflict resolutions, and implementation constraints.        |
| Public contracts   | [`packages/contracts`](../../packages/contracts)                                                     | Zod schemas, route registries, OpenAPI goldens, and shared wire types.                 |
| Runtime guardrails | [`packages/worker-runtime`](../../packages/worker-runtime)                                           | Route registrar, request guard, principals, errors, rate limiting, and Sentry helpers. |
| Auth helpers       | [`packages/auth`](../../packages/auth)                                                               | Request IDs, auth response helpers, and shared auth lookup/cache helpers.              |
| Durable state      | [`packages/db`](../../packages/db)                                                                   | Drizzle schema, migrations, RLS, repository core, Postgres adapter, and local adapter. |
| Command sequencing | [`packages/commands`](../../packages/commands)                                                       | `runCommand`, idempotency claim/replay, audit sequencing, and queue target helpers.    |
| Token crypto       | [`packages/tokens`](../../packages/tokens), [`packages/rotation`](../../packages/rotation)           | Signed token codecs, key/pepper rings, token kinds, and rotation playbooks.            |
| API control plane  | [`apps/api`](../../apps/api)                                                                         | Authenticated mutations, web API, Agent View, Access Link resolution, and operators.   |
| Upload path        | [`apps/upload`](../../apps/upload)                                                                   | Upload Sessions, signed PUT URLs, R2 writes, and finalize.                             |
| Content serving    | [`apps/content`](../../apps/content)                                                                 | Signed content reads, denylist checks, MIME/CSP/cache headers, and R2 streaming.       |
| Dashboard          | [`apps/web`](../../apps/web)                                                                         | TanStack Start routes, WorkOS session handling, dashboard UI, and server mutations.    |
| Lifecycle jobs     | [`apps/jobs`](../../apps/jobs)                                                                       | Queue consumers, cron discovery, bundle generation, byte purge, retention, and scans.  |
| Live Updates       | [`apps/stream`](../../apps/stream)                                                                   | Artifact Durable Object, SSE fan-out, and viewer authorization through `api`.          |
| CLI                | [`apps/cli`](../../apps/cli), [`packages/api-client`](../../packages/api-client)                     | Login, credentials, publish flow, local admin commands, and API client calls.          |
| Marketing surface  | [`apps/apex`](../../apps/apex)                                                                       | Public homepage, `/llms.txt`, `/agents.md`, and app redirects.                         |
| MCP scaffold       | [`apps/mcp`](../../apps/mcp), [`packages/contracts/src/mcp.ts`](../../packages/contracts/src/mcp.ts) | Future OAuth-only MCP transport, tool registry, and forwarded API call plans.          |
| Storage helpers    | [`packages/storage`](../../packages/storage), [`packages/config`](../../packages/config)             | Served content type mapping, security headers, paths, limits, and expiration helpers.  |
| Repo policy        | [`packages/repo-lint`](../../packages/repo-lint), [`scripts/README.md`](../../scripts/README.md)     | Monorepo guardrails, deployment scripts, smoke scripts, and maintenance commands.      |

## Common Lookups

| If You Need To Change            | Check These First                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A public or internal HTTP route  | [`packages/contracts/src/routes.ts`](../../packages/contracts/src/routes.ts), the matching `docs/specs/*.md`, then the owning `apps/*/src/index.ts`.                                                                                                                                                                                                        |
| OpenAPI output                   | [`packages/contracts/src/openapi`](../../packages/contracts/src/openapi), [`packages/contracts/openapi`](../../packages/contracts/openapi), `pnpm openapi:check`.                                                                                                                                                                                           |
| API auth, scopes, or rate limits | [`packages/contracts/src/routes.ts`](../../packages/contracts/src/routes.ts), [`packages/worker-runtime`](../../packages/worker-runtime), owning Worker tests.                                                                                                                                                                                              |
| Database schema or RLS           | [`packages/db/src/schema.ts`](../../packages/db/src/schema.ts), [`packages/db/migrations`](../../packages/db/migrations), [`packages/db/src/postgres`](../../packages/db/src/postgres).                                                                                                                                                                     |
| Repository behavior              | [`packages/db/src/repository/core.ts`](../../packages/db/src/repository/core.ts), repository adapters, and focused tests in [`packages/db/src`](../../packages/db/src).                                                                                                                                                                                     |
| CLI publish/login behavior       | [`apps/cli/src`](../../apps/cli/src), [`packages/api-client/src/index.ts`](../../packages/api-client/src/index.ts), API and upload contracts.                                                                                                                                                                                                               |
| Dashboard behavior               | [`apps/web/src/routes`](../../apps/web/src/routes), [`apps/web/src/server`](../../apps/web/src/server), [`apps/web/test`](../../apps/web/test).                                                                                                                                                                                                             |
| Access Links                     | [`packages/contracts/src/accessLinks.ts`](../../packages/contracts/src/accessLinks.ts), [`packages/tokens/src/access-link.ts`](../../packages/tokens/src/access-link.ts), [`packages/db/src/access-links.ts`](../../packages/db/src/access-links.ts), `apps/api`, and [`apps/web/src/routes/al.$publicId.tsx`](../../apps/web/src/routes/al.$publicId.tsx). |
| Live Updates                     | [`apps/stream`](../../apps/stream), [`apps/api/src/live-updates.ts`](../../apps/api/src/live-updates.ts), [`packages/contracts/src/liveUpdates.ts`](../../packages/contracts/src/liveUpdates.ts), [ADR 0069](../adr/0069-live-updates-via-stream-worker-and-per-artifact-durable-object.md).                                                                |
| Bundle generation                | [`apps/jobs/src/bundle`](../../apps/jobs/src/bundle), [`apps/jobs/src/handlers/bundle-generate.ts`](../../apps/jobs/src/handlers/bundle-generate.ts), [`packages/contracts/src/bundle.ts`](../../packages/contracts/src/bundle.ts).                                                                                                                         |
| Operator/admin behavior          | [`apps/api/src/operator.ts`](../../apps/api/src/operator.ts), [`apps/web/src/routes/_authed.admin.tsx`](../../apps/web/src/routes/_authed.admin.tsx), [`docs/specs/admin.md`](../specs/admin.md), [ADR 0046](../adr/0046-operator-identity-and-web-admin-surface.md).                                                                                       |
| Hosted deploys or smokes         | [`docs/ops/status/hosted-ops.md`](../ops/status/hosted-ops.md), [`docs/ops/bootstrap-hosting-checklist.md`](../ops/bootstrap-hosting-checklist.md), [`scripts`](../../scripts), and [`.github/workflows`](../../.github/workflows).                                                                                                                         |
| Agent workflow or delegation     | [`docs/agents/workflow.md`](./workflow.md), [`docs/agents/autonomous-loop.md`](./autonomous-loop.md), [`docs/agents/environment-adapters.md`](./environment-adapters.md), [`docs/agents/issue-tracker.md`](./issue-tracker.md).                                                                                                                             |

For repo-local skill selection:

- Use `.claude/skills/workflow-agent-queue/SKILL.md` for
  the recurring implementation queue loop across Linear, agents, PR checks, and
  review feedback.
- Use
  `.claude/skills/workflow-agent-review/SKILL.md` for
  the periodic sidecar review of newly landed `main` commits that should become
  queued fixes.

## Search Recipes

Prefer `rg` over broad directory browsing.

```sh
rg "routeId|path|error_code" packages/contracts apps packages
rg "Artifact|Access Link|Workspace" CONTEXT.md docs packages apps
rg "operation.event|runCommand|idempotency" packages apps
rg "wrangler|binding|queue|r2|kv" apps scripts docs/ops
rg --files apps packages docs | rg "README|test|migration|wrangler|openapi"
```

For a route, start with the route contract, then follow imports to the owning
Worker handler and repository method. For a domain term, start in
[`CONTEXT.md`](../../CONTEXT.md), then check specs and ADRs before editing code.

## Verification Pointers

Use the narrowest check that covers the change while iterating:

```sh
pnpm --filter <package-name> test
pnpm --filter <package-name> typecheck
pnpm openapi:check
pnpm format:docs:check
```

Before PR handoff, run ticket-specific checks and then `pnpm verify` unless the
task or environment explicitly says a narrower handoff is acceptable.

## Maintenance

Update this file when a new app/package becomes an owner of a major workflow or
when an existing workflow moves. Do not use this file for active status; update
[`docs/ops/project-status.md`](../ops/project-status.md) and the linked ledgers
instead.
