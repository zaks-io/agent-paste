# Contributing to agent-paste

Thanks for your interest. This repo is developed two ways, and both are first-class:

- **Human contributors** — clone, branch, change, open a PR. Jump to [For human contributors](#for-human-contributors).
- **AI agents** — driven through Linear and an orchestration workflow. Jump to [For AI agents](#for-ai-agents).

The same quality gates apply to both.

agent-paste is live in production and in **early alpha**. Public users, issued API
Keys, published Artifacts, and npm installs may exist. Preserve supported
behavior, or make breaking changes explicit in specs, docs, and
migration/operational notes. Do not add legacy or deprecated code paths unless
they are required to preserve a current public contract.

For vulnerabilities, do not open a public issue. Follow [`SECURITY.md`](./SECURITY.md).

## Quick start (everyone)

Prerequisites:

- Node from [`.nvmrc`](./.nvmrc) (24.x).
- Corepack-managed `pnpm` pinned in [`package.json`](./package.json).

Fresh git worktree:

```sh
pnpm setup:worktree
```

Normal local install:

```sh
corepack enable
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm hooks:install
```

The full command reference (dev servers, smoke tests, deploy, contracts/DB) lives in
[`docs/development.md`](./docs/development.md). This file won't repeat it.

## For human contributors

### Where work is tracked

Active work is tracked in **Linear** (team prefix `AP-`), not GitHub Issues. If you can't see Linear, open a GitHub
issue or discussion, or send a small PR with enough context to stand on its own. Security reports go through
[`SECURITY.md`](./SECURITY.md), never a public issue.

### Branch and commit

Branch off `main`.

Commits follow **Conventional Commits**, with the tracker/PR reference in the subject:

```text
fix(cli): shell-backend keychain so standalone binary runs (AP-147)
feat(deploy): ADR 0078 secret system + credential-free read-only smoke (#191)
refactor(content,upload): extract serve and finalize pipelines (AP-141)
```

Use `type(scope): summary` and append `(AP-NN)` or `(#NN)` when one applies. There is no commitlint config; match the
existing `git log`.

### Before you push

Run the local CI-equivalent:

```sh
pnpm verify
```

**Test policy:** new or changed functionality must ship with tests in the same change. This is enforced, not
aspirational: CI's `Validate` job runs `pnpm test:coverage` against global coverage thresholds, so a feature without
tests fails the gate. New `apps/web` component and lib code in particular needs branch tests.

**Important:** `pnpm verify` does **not** run coverage or the local harness smoke.
CI's `Validate` job runs `pnpm smoke:local` and `pnpm test:coverage` separately,
enforcing cross-Worker integration coverage and global coverage thresholds; the
pre-push hook runs coverage too — even when `pnpm verify` is green.

Formatting and lint are codified, not hand-applied:

```sh
pnpm format   # Biome for code, Prettier for Markdown
pnpm lint     # turbo lint + repo policy checks
```

Rules live in [`biome.json`](./biome.json); don't fight the formatter.

### Git hooks

Hooks are managed by Lefthook ([`lefthook.yml`](./lefthook.yml)) and install via `pnpm hooks:install` (also wired into
`prepare`). `pre-commit` runs Biome on staged files, Prettier on staged Markdown, `gitleaks protect`, and a typecheck;
`pre-push` runs dead-code and coverage checks. Never bypass `gitleaks` to push a secret.

### Open a PR

Open the PR against `main`. The merge gate is the `Validate` CI check plus resolved review threads; the branch ruleset
requires zero approvals, so green CI and resolved threads are what merge a PR.

There is no enforced PR template. By convention, write the body as **Summary / Changes / Risk / Test plan**.

## For AI agents

Agents start with [`AGENTS.md`](./AGENTS.md), then follow the reading order it names. The workflow and tracker contract
live in:

- [`docs/agents/workflow.md`](./docs/agents/workflow.md) — the staged orchestration workflow.
- [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md) — Linear team, states, and `AP-` conventions.
- [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md) — triage label meanings.
- [`docs/agents/repo-navigation.md`](./docs/agents/repo-navigation.md) — repo map and workflow ownership.

Linear is the queue. The quality gates above (`pnpm verify`, coverage, Conventional Commits, the `Validate` CI check)
apply to agent PRs exactly as they do to human ones.

## Project layout and docs

- [`README.md`](./README.md) — human-friendly repo entry point.
- [`docs/development.md`](./docs/development.md) — command tables, workspace inventory, and monorepo policy.
- [`CONTEXT.md`](./CONTEXT.md) — domain language. Read it before touching the data model.
- [`docs/specs/README.md`](./docs/specs/README.md) — product/spec reading order.
- [`docs/adr/README.md`](./docs/adr/README.md) — architecture decision index and current conflict resolutions.
- [`docs/ops/project-status.md`](./docs/ops/project-status.md) — current implementation state, verified checks, and the
  ordered backlog.

## License and contribution terms

agent-paste is licensed under **Apache-2.0** ([`LICENSE`](./LICENSE), [`NOTICE`](./NOTICE)). Contributions are accepted
under the same license (inbound equals outbound). There is no CLA, DCO, or sign-off requirement.

The source is open under Apache-2.0. The hosted service operated by Zaks.io, LLC is a separate, commercial offering; the
license covers the code, not access to the hosted product.
