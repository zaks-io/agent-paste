# repo-lint

Repo-wide lint and monorepo policy checks.

`pnpm --filter @agent-paste/repo-lint lint` runs Biome over repo-level docs/config/scripts and then runs `src/monorepo-policy.mjs`.

The policy checker validates workspace metadata, package script conventions, internal dependency protocols, catalog usage, Turborepo/pnpm guardrails, and README coverage for workspace paths and root scripts.
