# Agent Config

Last updated: 2026-06-09

Last verification (2026-06-09, refresh): deploy command table + CodeRabbit mode
(incl. `@coderabbitai ignore` opt-out policy for trivial PRs) re-verified against
live repo. Evidence: `package.json` scripts (`deploy:preview`/
`deploy:production` now `node scripts/deploy.mjs <target>`, migrate decoupled),
`turbo.json` (`deploy:preview`/`deploy:production` tasks present), `.coderabbit.yaml`
(`auto_review.enabled: true`), Linear read-only `list_issues team="Agent Paste"`
(team `64852379-2e05-41f5-af59-275b68be78ae`, project `agent-paste Roadmap`
`a9161ce3-5868-45fe-a5cc-177881c84cf9` resolve; `status`/`statusType` fields
confirmed). Not re-verified this pass: full label/state inventory, milestone IDs
(unchanged since 2026-06-06).

Metadata-only config consumed by the `ziw-*` skills. Authoritative detail
lives in the linked docs; this file is the distilled, machine-readable index.
When this file and a linked doc disagree, the linked doc wins and this file
should be corrected.

Read first: `docs/agents/workflow.md`, `docs/agents/issue-tracker.md`,
`docs/agents/skill-usage.md`, `docs/agents/repo-navigation.md`,
`docs/agents/environment-adapters.md`, `docs/agents/triage-labels.md`.

## Repo

- Name: agent-paste
- Default branch: main
- Branch prefix: `<runtime>/<issue-id>-<slug>` (e.g. `codex/ap-33-…`,
  `cursor/ap-32-…`); plain Conventional-Commit prefixes (`feat/`, `fix/`,
  `docs/`, `chore/`) are also in use for non-delegated work
- Package manager: pnpm@10.19.0 (Corepack), Node `>=24 <25`
- Install: `pnpm install --frozen-lockfile --strict-peer-dependencies`
- Full local gate: `pnpm verify` (CI also runs `pnpm test:coverage`)
- Focused checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm openapi:check`, `pnpm --filter @agent-paste/db db:check`, `pnpm knip`
- Build: `pnpm build`
- Generated artifacts: OpenAPI (`pnpm openapi:write`), DB introspection
  (`db:check`); regenerate, never hand-edit
- Smoke: `pnpm smoke:local`, `pnpm smoke:mcp`, `pnpm smoke:web`
- Preview checks: PR-preview deploy + hosted smoke via `.github/workflows/pr-preview.yml`
- Manual preview deploy: `pnpm deploy:preview` (whole fleet) or
  `pnpm deploy:preview --app=<worker>` (one Worker; `stream|api|upload|content|jobs|mcp|apex|web`).
  Single entry `scripts/deploy.mjs`: migrates only when a DB-backed app
  (`api`/`upload`/`jobs`) is in scope unless `--no-migrate`, provisions secrets,
  then `turbo run deploy:<target>` (build is a Turbo task, `dependsOn: build`).
  Migration is NOT glued to deploy (decoupled 2026-06-09, AP-278). Laptop preview
  deploys are fine and expected.
- Production deploy path: `.github/workflows/deploy-production.yml`
  (CI/CD only; `pnpm deploy:production` is the manual path and is gated; no `--app`
  scoping for production)
- Production approval required: yes

## Issue Tracker

- Provider: Linear
- Provider location: team prefix `AP-`
- Project, board, repo, milestone, or roadmap: `agent-paste Roadmap`,
  execution-wave milestones `Wave 0`–`Wave 7` (see `docs/agents/issue-tracker.md`)
- Routing label: `ready-for-agent`
- Triage scope: AP team; see `docs/agents/triage-labels.md`
- Friction-log ticket: `AP-98` (parked in `Backlog`, no readiness labels, out of
  the work queue); orchestrator appends retrospective metadata-only comments here
- Orphan policy: route only when project/team/parent/label is directly
  evidenced; leave ambiguous orphans in triage with `needs-info` /
  `ready-for-human`; never cancel solely for staleness
- Issue key examples: `AP-12`, `AP-47`, `AP-85`
- Ready state: `Todo`
- Active states: `In Progress`, `Blocked`, `In Review`, `Changes Requested`,
  `Ready to Merge`
- Done state: `Done` (also `Canceled`)
- Status transition owner: Agent Orchestrate (`ziw-orchestrate`)
- Readiness labels (Linear `Readiness` group): `needs-triage`, `needs-info`,
  `ready-for-agent`, `ready-for-human`, `wontfix`; plus ungrouped `remote-cursor`
- Risk labels (exist in Linear, ungrouped): `risk-normal`,
  `risk-security-sensitive` (auth/custody/secrets/audit/authz), `risk-schema`
  (schema/migrations/RLS/data contracts), `risk-cross-cutting` (multiple
  packages/seams/workflows). PR body also carries LOW/MEDIUM/HIGH.
- Type labels (Linear `Type` group): `Bug`, `Feature`, `Improvement`,
  `Tech Debt`, `Spike`, `Hotfix`
- Area labels: ad hoc (`frontend`, `research`, `enhancement`); per touched
  package/app otherwise
- Priority policy: Linear priority field; agent picks highest-priority ready
  unblocked work
- Dependency policy: encode with Linear issue relationships; blocked work is not
  `ready-for-agent`
- Readiness-label query policy: queries for `ready-for-agent`, `ready-for-human`,
  or equivalent attention labels exclude the configured Done state unless the
  user explicitly asks to audit or repair done-ticket cleanup
- Agent-ready issue body: outcome, context docs, in scope, out of scope,
  acceptance criteria, required checks, cross-layer invariants, dependencies
  (see issue-tracker-contract reference)
- Labels are signals, not authority: yes — Linear workflow state is the source
  of truth; Agent Orchestrate owns transitions

## Work Coordination

- Authoritative issue state: Linear (AP team)
- Authoritative PR state: GitHub
- Authoritative check state: GitHub Actions (`CI` workflow) + preview smoke
- Authoritative deploy state: Cloudflare Workers via deploy workflows
- Queue mutation authority: Agent Orchestrate only
- Implement authority: Agent Implement (`ziw-implement`)
- Review authority: Agent Review (`ziw-review` /
  `ziw-code-review`)
- Merge authority: human / Agent Orchestrate when explicitly delegated; `main` ruleset
  (verified live 2026-06-01) requires 0 approvals and only the `Validate` check
  green, so solo merges use plain `gh pr merge --squash` (no `--admin`)
- Claim record: Linear assignment + `In Progress` state
- Queue local state: scratch only; refresh Linear/GitHub before acting
- Handoff format: see `.claude/skills/ziw-setup/references/handoff.md`
  (Issue, Branch, PR, Owner,
  Runtime, Environment, Current state, Next owner/action, Checks, Code review,
  Tracker updates, Blockers, Residual risk)
- PR closure guard: capacity pressure is not a closure reason. Orchestrator may
  close PRs only with refreshed code-host and tracker evidence of duplicate,
  explicitly canceled or abandoned, already-terminal, or security/policy-required
  work. Draft, active, recently updated, or unclear-ownership PRs stay open and
  become capacity blockers or active work to advance

## Agent Runtimes

- Local Codex: queue orchestration, repo-wide edits, local verification, PR
  creation, Linear maintenance, periodic main review
- Remote worker: Cursor Background Agent for isolated `ready-for-agent` +
  `remote-cursor` tickets (Composer 2.5 workhorse); resume same thread/branch/PR
  on `Changes Requested`
- Claude: planning, docs, second-pass review, or implementation when the user
  picks it; uses canonical `.claude/skills`, not personal globals
- Review model policy: strongest available tier for auth, authorization,
  secrets, schemas, background jobs, cross-package contracts, destructive paths
- Agent Orchestrate: `ziw-orchestrate`
- Agent Review: `ziw-review` (PR + main drift)
- Agent Implement: `ziw-implement`
- Issue Triage: `ziw-triage`
- Decompose spec/PRD/epic into tickets: `ziw-to-issues`
- Setup: `ziw-setup`

## Pull Requests

- PR title: Linear issue title when available, `<70` chars, Conventional-Commit
  style
- PR body: Summary / Changes / Risk (LOW|MEDIUM|HIGH) / Test plan + Linear link
- Required checks: `pnpm verify` + `pnpm test:coverage` (CI `Validate` job);
  preview smoke for hosted-affecting changes
- Code review: `ziw-code-review` before PR; `ziw-review` for
  PR review
- CodeRabbit: auto-review ENABLED (verified live in `.coderabbit.yaml` 2026-06-09:
  `reviews.auto_review.enabled: true`, `profile: assertive`, drafts reviewed,
  `auto_pause_after_reviewed_commits: 5`, `base_branches: [main]`). It reviews
  every PR automatically — do NOT manually trigger. Local `ziw-code-review` before
  PR is still good practice. Use `@coderabbitai full review` only to force a fresh
  pass on a high-risk PR whose head moved past the last review.
- CodeRabbit opt-out for trivial PRs: since auto-review is on, suppress it on
  trivial changes (docs/comments/copy/formatting/version bumps/config-only with no
  logic change) by adding `@coderabbitai ignore` to the PR description at creation.
  This conserves the review budget for changes that matter. Do NOT add it to PRs
  touching logic, auth, secrets, schemas, deploy/CI, or anything `risk-*`-labeled.
- Issue update: attach PR, move to `In Review`, comment checks/review verdict;
  never move to `Done`
- Merge authority: see Work Coordination

## Environments

- Local: self-contained in-memory MVP harness (`scripts/local-mvp-server.mjs`),
  mocked R2/KV, PGlite for tests; no Docker/Postgres needed
- Local commands: `pnpm dev:all`, `pnpm cli:dev …`, `pnpm smoke:local`
- Local services: API :8787, Upload :8788, Content :8789; admin token
  `local-admin-token`
- Development: may use cloud backing services while the app runs locally
- Development backing services: Cloudflare R2/KV, Neon Postgres (see
  `agent-paste-neon-postgres` skill)
- Preview: PR-scoped Cloudflare Workers deploy + hosted smoke
- Preview purpose: validate hosted behavior per PR; auto-cleaned on close
- Production: explicit approval required
- Production forbidden without approval: `pnpm deploy:production`,
  `wrangler secret put`, any manual mutation of production Workers/data
- Hosted checks allowed without approval: preview smoke, read-only Sentry/CF
  inspection
- Hosted checks requiring approval: anything touching production resources

## Unknowns

- [ ] `docs/agents/triage-labels.md` documents only the 5 readiness labels but
      Linear also has `risk-*` and the `Type` group; the repo doc is stale.
      Backfill it (out of scope for this config).
- [ ] `Triage` / `Backlog` Linear states are not documented in
      `docs/agents/workflow.md`; confirm whether they exist in the AP team or
      whether `Todo` is the sole pre-active state.
