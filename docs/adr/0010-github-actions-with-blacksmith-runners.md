# GitHub Actions with Blacksmith Runners

GitHub Actions will orchestrate CI, preview, cleanup, and production deployment workflows, using Blacksmith for the runner and caching layer. Workflows should be split by purpose so validation, preview deployment, preview cleanup, and production promotion can evolve independently.

## Consequences

- `ci` should install with the pnpm lockfile, enforce dependency guardrails, lint, typecheck, and test.
- `preview` should create or update PR-scoped infrastructure, run migrations for the preview schema, deploy preview apps, and report preview URLs.
- `cleanup-preview` should destroy PR-scoped resources on close and run a scheduled janitor for stale resources.
- `deploy-production` should run only from `main` after CI passes, require GitHub Environment approval, run migrations for production, and deploy apps through GitHub Environment protections.
- Cloudflare credentials should be environment-scoped and least-privileged where practical.
- Blacksmith should be used for fast, consistent GitHub Actions execution rather than replacing GitHub Actions as the workflow source of truth.
