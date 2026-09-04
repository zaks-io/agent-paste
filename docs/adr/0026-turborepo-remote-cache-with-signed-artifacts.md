# Turborepo Remote Cache with Signed Artifacts

Turborepo remote cache runs against Vercel Remote Cache with HMAC artifact signing enabled and `envMode: strict` so undeclared environment variables cannot silently change task fingerprints. In GitHub Actions, remote-cache credentials and write authority are restricted to trusted CI and deploy workflows. Public fork PRs receive no remote-cache credentials and use local Turbo caching.

## Consequences

- `turbo.json` sets `remoteCache.signature: true` and `envMode: "strict"`.
- `TURBO_REMOTE_CACHE_SIGNATURE_KEY` is stored as a GitHub Actions secret and exposed locally through the project's secret manager. The same value is used in trusted CI, deploy workflows, and local development.
- Every env var that influences build or runtime output must be declared in `globalEnv` or per-task `env`. Secrets reach the task through `globalPassThroughEnv` or per-task `passThroughEnv` and never become part of the cache key.
- `globalDependencies` includes `.env*` files so local env changes invalidate the cache.
- Remote-cache writes are available to trusted CI and deploy workflows plus authenticated local development. Untrusted fork PRs cannot read or write the remote cache.
- Every public fork PR runs the PR-range secret scan without infrastructure credentials. Docs-only fork PRs report a green no-op `Validate`; code-changing fork PRs run deterministic validation, local smoke, Postgres smoke, coverage, and OpenAPI checks. GitHub withholds repository secrets and gives fork PR workflows a read-only `GITHUB_TOKEN`, so those runs use local Turbo caching and cannot deploy or comment.
- PR validation treats remote-cache credentials as optional and falls back to local cache when `TURBO_TOKEN` / `TURBO_TEAM` are unavailable. Secret-bearing PR previews remain a separate, opt-in workflow restricted to labeled branches in this repository.
- If signed cache integrity is ever in doubt, production deploys can disable remote cache reads or run with `--force` to rebuild from scratch.
