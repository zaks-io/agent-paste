# Turborepo Remote Cache with Signed Artifacts

Turborepo remote cache will run against Vercel Remote Cache with HMAC artifact signing enabled and `envMode: strict` so undeclared environment variables cannot silently change task fingerprints. Cache writes are unrestricted for now because the project is solo-developer with controlled inputs; this should be revisited when external contributors or untrusted PR sources are added.

## Consequences

- `turbo.json` sets `remoteCache.signature: true` and `envMode: "strict"`.
- `TURBO_REMOTE_CACHE_SIGNATURE_KEY` is stored as a GitHub Environment secret and exposed locally through the project's secret manager. The same value is used in CI and local development.
- Every env var that influences build or runtime output must be declared in `globalEnv` or per-task `env`. Secrets reach the task through `globalPassThroughEnv` or per-task `passThroughEnv` and never become part of the cache key.
- `globalDependencies` includes `.env*` files so local env changes invalidate the cache.
- Open cache writes are an interim trade-off chosen for setup simplicity. When trust boundaries expand, restrict writes to `main` plus local development only, or use a separate cache scope for PR builds versus protected branches.
- While the public no-secret CI path is undefined, PR validation is limited to trusted `zaks-io` PR sources. External public PRs short-circuit instead of running the secret-bearing/internal validation stack.
- Trusted PR validation treats remote-cache credentials as optional and falls back to local cache when `TURBO_TOKEN` / `TURBO_TEAM` are unavailable.
- If cache poisoning becomes a real concern before write restrictions land, production deploys can disable remote cache reads or run with `--force` to rebuild from scratch.
