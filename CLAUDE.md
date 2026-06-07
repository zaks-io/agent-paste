# agent-paste

## Start here

Read `docs/ops/project-status.md` first. It is the status entrypoint and links to the detailed ledgers. When asked to "implement the next step," follow its link to `docs/ops/status/phase-backlog.md` and start at the top of the active phase.

Then: `CONTEXT.md` (domain language), `docs/specs/README.md` (spec reading order), `docs/adr/README.md` (ADR index).

**Specs are the current truth; ADRs are the decision trail.** When you need to know how the system behaves now — whether something is enforced, what a table holds, what a route does — read `docs/specs/`. The spec is the consolidated answer so you never have to read N ADRs to reconstruct the latest decision. ADRs record _why_ a decision was made; their conclusions should already be folded into the relevant spec. If a spec and an ADR conflict, the spec wins — but flag the conflict to a human, because it usually means the spec went stale and needs updating. Do not assert "the system doesn't do X" or "X isn't enforced" from an ADR (or from a Drizzle `schema.ts` read) without checking the spec first.

**Flag doc friction; fix the root cause.** When a doc is wrong, misleading, out of date, or missing — or when you hit the same friction a doc should have prevented — surface it to a human and propose the doc or process fix in the same turn. Do not silently work around a bad doc and move on; the workaround leaves the next agent to hit the same wall. The fix to the documentation is part of the task, not a separate chore.

If you need to get oriented or find the owner of a workflow quickly, use
`docs/agents/repo-navigation.md`.

## Project stage

Launch-readiness / pre-public launch. Production Workers are deployed and
smoke-tested, but the product and repo are not public yet. Do not modify
production without explicit approval. Do not add legacy, deprecated, or
back-compat code paths or migration shims; there are no public users to stay
compatible with yet. When behavior needs to change, change it outright.

## Agent skills

### Workflow

Read `docs/agents/workflow/config.md` before using the `ziw-*` skills
(`ziw-orchestrate`, `ziw-implement`, `ziw-review`, `ziw-code-review`, `ziw-pr`,
`ziw-triage`, `ziw-to-issues`, `ziw-setup`); it is
the metadata index for commands, tracker states, and environment safety.
Shared workflow docs live in `docs/agents/workflow.md`.
Use `docs/agents/skill-usage.md` to choose the smallest repo-local skill for a
task. Use `docs/agents/autonomous-loop.md` for the detailed Linear state
contract and queue-moving/worker loop. Use `docs/agents/repo-navigation.md`
for the repo map and common lookup paths.

### Issue tracker

Linear, team prefix `AP-`. See `docs/agents/issue-tracker.md`.

### Triage labels

Defaults applied as Linear labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Remote Cursor agents

Remote Cursor agents are unattended Cursor Background Agents for implementing
delegated Linear issues in an isolated remote environment.

Remote Cursor agents should read `docs/agents/remote-cursor-agent.md` after this
file. Only delegate issues labeled both `ready-for-agent` and `remote-cursor`.
Review fixes should return to the original Cursor thread, branch, and PR when
possible.

## Cursor Cloud specific instructions

### Environment

- **Node.js 24** is required (`engines` field enforces `>=24 <25`). The VM update script installs it via nvm.
- **pnpm 10.19.0** is managed by Corepack (`packageManager` field in root `package.json`).
- After dependencies are installed, the `.env` file is copied from `.env.example` if it does not already exist.

### Key commands

All standard commands are documented in the root `README.md` tables. Highlights for cloud agents:

| Task                                    | Command                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| Full local verification (CI-equivalent) | `pnpm verify`                                                                                |
| Lint                                    | `pnpm lint`                                                                                  |
| Typecheck                               | `pnpm typecheck`                                                                             |
| Unit/integration tests                  | `pnpm test`                                                                                  |
| Build all packages                      | `pnpm build`                                                                                 |
| Local E2E smoke test                    | `pnpm smoke:local`                                                                           |
| Start local dev server                  | `pnpm dev:all` (builds first, then starts in-memory API/Upload/Content on :8787/:8788/:8789) |

### Local dev server notes

- `pnpm dev:all` runs the in-memory MVP harness (`scripts/local-mvp-server.mjs`) with mocked R2/KV. No Docker or Postgres is needed for the quick dev path.
- The harness self-seeds a `local-proof-workspace` and proof artifacts on startup and prints the API/Upload/Content/Jobs/Stream base URLs plus the `AGENT_PASTE_*_URL` exports to copy. The legacy `ADMIN_TOKEN` / `admin workspace create` / `admin key create` flow was removed in AP-12/AP-13 and no longer exists.
- Follow the harness's own printed guidance to publish: `pnpm cli:dev login`, `pnpm cli:dev whoami`, `pnpm cli:dev publish examples/local-harness/site`.
- The CLI resolves paths relative to `apps/cli/`, so use absolute paths when calling `pnpm cli:dev publish`.

### Worktree env + web dev server

- A fresh git worktree has no local env files. Run `pnpm setup:worktree` (alias `pnpm setup:codex`) to copy ignored `.env*` and `.dev.vars*` — including nested ones like `apps/web/.dev.vars` — from the main checkout (the worktree owning the shared `.git` dir). Pass `--skip-install` if deps are already linked, `--force` to overwrite, `--source <path>` to override the source. Script: `scripts/setup-worktree.mjs`.
- The human web app (`apps/web`, `pnpm dev` / `vite dev` on **:5173**) is WorkOS-authed and **500s on every authed route without WorkOS secrets** in `apps/web/.dev.vars` (`WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_REDIRECT_URI=http://localhost:5173/api/auth/callback`, `WORKOS_COOKIE_PASSWORD` ≥32 chars, `WORKOS_COOKIE_NAME`). The WorkOS app must allow `http://localhost:5173/api/auth/callback` as a redirect URI. These secrets are not in `.env.example`; they live only in real `.dev.vars`.
- For UI-only visual checks without WorkOS, a throwaway Vite harness rendering the real primitives + `globals.css` with mock data is the fast path (no auth needed).

### Gotchas

- pnpm may report "Ignored build scripts" for esbuild/workerd/lefthook/sharp. This does not break builds because the native platform packages are listed as `optionalDependencies` which provide pre-built binaries.
- Tests use `@electric-sql/pglite` for in-memory Postgres — no Docker or real Postgres is needed for `pnpm test`.
- Turborepo caches aggressively. If you see stale results after modifying non-source files (e.g. env vars), pass `--force` to the turbo command.
