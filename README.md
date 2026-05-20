# agent-paste

Agent-paste is a platform for agents to publish durable, shareable work products as **Artifacts**.

This repository is currently prepared for implementation. Product language, decisions, and implementation contracts live in:

- [`CONTEXT.md`](./CONTEXT.md): domain language.
- [`docs/specs/`](./docs/specs): implementation-facing product contracts.
- [`docs/adr/`](./docs/adr): architectural decision records.
- [`packages/contracts`](./packages/contracts): canonical Zod schemas and route/tool registries.

No runtime application code has been implemented yet.

## Planned Workspace Shape

- `apps/api`: authenticated control-plane Worker.
- `apps/upload`: upload-session and encrypted upload Worker.
- `apps/content`: isolated untrusted-content Worker.
- `apps/jobs`: queue and cron Worker.
- `apps/web`: dashboard, Access Link viewer, and operator UI.
- `apps/mcp`: hosted OAuth-only MCP Worker.
- `apps/cli`: npm CLI.
- `packages/contracts`: request/response schemas and route/tool registries.
- `packages/api-client`: internal TypeScript API client used by the CLI.
- `packages/auth`: reusable auth and scope primitives.
- `packages/commands`: transactional command wrapper.
- `packages/config`: environment parsing helpers.
- `packages/db`: Drizzle schema, migrations, and query helpers.
- `packages/storage`: R2 key and content-token helpers.
- `packages/tsconfig`: shared TypeScript configuration.

## Git Hooks

Lefthook is configured at the repo root. Install hooks with:

```sh
pnpm hooks:install
```

`pre-commit` runs Biome on staged files, `gitleaks protect --staged --redact`, and Turbo typecheck for packages affected since `origin/main` with a local `HEAD` fallback. `pre-push` runs the affected test task with the same fallback.
