# Remote Cursor Agent Handoff

This repo is prepared for Cursor Background Agents working from Linear issues.
Use this document together with `AGENTS.md`; do not treat it as a replacement
for the repo instructions.

## Required Reading Order

1. `AGENTS.md`
2. This file
3. `docs/ops/project-status.md`
4. `CONTEXT.md`
5. `docs/specs/README.md`
6. `docs/adr/README.md`
7. The Linear issue and any linked ADRs/specs/runbooks

When a ticket names a specific app/package, also read that app/package README
before editing.

## Environment Setup

Cursor Background Agents use `.cursor/environment.json`. The install command is:

```sh
pnpm setup:codex --skip-env
```

That command installs the Node/pnpm toolchain expected by this repo and avoids
copying local secrets into a remote environment.

The Cursor image includes Chromium for the Lighthouse dashboard accessibility
gate. The repo's Node version is pinned by `.nvmrc` and `.node-version`, and the
package manager is pinned in `package.json`.

## Cursor Docs Quick Start

Useful Cursor docs for maintaining this setup:

- [Background Agents](https://docs.cursor.com/en/background-agent): remote
  agents clone the repo from GitHub, work on their own branch, and run in an
  isolated machine. Keep GitHub access limited to the repos the agent needs.
- [Rules and context](https://docs.cursor.com/en/context): Cursor reads
  root-level `AGENTS.md` as simple project instructions. Use `.cursor/rules`
  later only if this repo needs rules to be scoped or reusable.
- [Environment schema](https://cursor.com/schemas/environment.schema.json):
  validates `.cursor/environment.json`. The schema currently accepts top-level
  `build`, `install`, `start`, `terminals`, `ports`, and related fields.

Operational notes from the Background Agents docs:

- Keep system packages in `.cursor/Dockerfile`; do not copy the repo into the
  image. Cursor checks out the target branch into the workspace.
- Keep dependency setup in `.cursor/environment.json`'s `install` command. It
  should be safe to run repeatedly after branch changes.
- Use `terminals` only for long-running processes that should be alive while the
  agent works. This repo leaves it empty because tests and smokes start their
  own local processes.
- Treat hosted secrets as opt-in per ticket. Background agents can run commands
  without foreground approval, so production or preview credentials should only
  be present when the Linear issue explicitly requires them.
- Do not assume the `coderabbit` CLI is available inside Cursor's remote agent
  environment. CodeRabbit is on-demand only and should be reserved for the
  high-risk cases described in the repo-local `code-review` skill.

## Repo-Local Skills

This repo carries real copies of shared skills so remote environments use the
same review workflow as local agents:

- `.claude/skills/create-pr`
- `.claude/skills/code-review`
- `.agents/skills/create-pr`
- `.agents/skills/code-review`

Do not replace these with symlinks. Remote Cursor environments should be able to
clone the repo and read the skill files directly.

Before opening a PR, run the repo-local `code-review` workflow as a read-only
review pass. Use CodeRabbit only when that skill recommends escalation or the
change is high risk: auth, authorization, secrets, migrations, destructive data
changes, background jobs, concurrency, generated artifacts, public API/CLI
contracts, or broad refactors.

## Normal Commands

Use focused commands while iterating:

```sh
pnpm --filter <package-name> test
pnpm --filter <package-name> typecheck
pnpm openapi:check
```

Before handoff, run the ticket-specific verification and then:

```sh
pnpm verify
```

Run local smoke when the change touches the publish/read/delete path or shared
runtime behavior:

```sh
pnpm smoke:local
```

For web accessibility changes, run:

```sh
pnpm build
pnpm lighthouse:dashboard-a11y
```

## Hosted Secrets And Deploys

Remote Cursor agents should not receive production secrets by default.

Do not run these commands unless the Linear issue explicitly says the required
credentials are available and Isaac has approved the hosted action:

```sh
pnpm deploy:production
pnpm smoke:production
pnpm bootstrap:production
pnpm migrate:production
```

Preview deploys, preview migrations, and hosted preview smoke are also
credentialed operations. Run them only when the issue explicitly asks for hosted
verification and the environment contains the needed secrets.

Local commands and in-memory smoke tests are the default verification path.

## Linear Workflow

Issues live in Linear team `AP`.

Use the `agent-paste Roadmap` project and its execution-wave milestones:

- `Wave 0 - Agent Handoff Ready`
- `Wave 1 - Operator And Ops Hardening`
- `Wave 2 - Access Links And Artifact Lifecycle`
- `Wave 3 - Live Updates`
- `Wave 4 - MCP`
- `Wave 5 - Platform Hardening`
- `Wave 6 - Monetization`
- `Wave 7 - Cleanup And Deferred Polish`

Only pick up issues labeled both `ready-for-agent` and `remote-cursor`.

If a ticket is missing enough detail to implement safely, do not guess. Add a
Linear comment with the blocker and move or ask for the ticket to be moved to
`needs-info`.

If the ticket requires a product/security decision, leave implementation
untouched and move or ask for the ticket to be moved to `ready-for-human`.

Respect milestone dependencies. For example, do not implement the Access Link
viewer before the Access Link model/codec ticket is complete.

## Pull requests (ready for review, not draft)

Create GitHub pull requests **ready for review** (`draft: false`). Do not open
draft PRs unless the Linear issue explicitly asks for a draft.

This repo does not rely on automatic CodeRabbit review for every PR. Run the
repo-local `code-review` skill first. If it recommends CodeRabbit, request
CodeRabbit explicitly with a PR comment after the PR exists and address only
high-priority actionable findings.

There is no separate Cursor or repo UI setting for this today; follow this
handoff doc and any Linear issue that overrides it.

When the PR is ready for review, move the linked Linear issue to **In Review**
in the same pass (see PR Handoff Checklist). The GitHub integration attaches the
PR when the branch and PR are linked to the issue; do not add a Linear comment
just to paste the PR URL.

## PR Handoff Checklist

The final PR or handoff comment must include:

- Summary of the behavior changed.
- Files changed.
- Tests and checks run, with exact command names.
- Review result: local `code-review` verdict and CodeRabbit
  `skipped`/`CLI`/`PR review` decision.
- Any checks not run and why.
- Known gaps, follow-up tickets, or blocked hosted verification.
- Docs/status ledgers updated when the change affects project status.
- **Linear issue moved to In Review** for the ticket you implemented once the PR
  is ready for review. Use `save_issue` per `docs/agents/issue-tracker.md`. Do
  not leave the issue in an in-progress state after handoff. Use Linear comments
  only for blockers or handoff gaps—not to duplicate the PR link.

Keep the change scoped to the issue. Do not bundle unrelated cleanup into a
remote-agent branch.
