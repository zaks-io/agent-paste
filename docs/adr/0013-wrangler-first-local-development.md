# Wrangler-First Local Development

Local development will be Wrangler-first so developers exercise Cloudflare Worker behavior, bindings, and request handling during normal development. Turborepo scripts should make apps easy to run, but they should wrap or compose Wrangler rather than replacing the Cloudflare development model.

## Consequences

- Each Worker app should support an app-local `dev` command based on `wrangler dev`.
- Root Turborepo scripts should allow running one app or a useful subset of apps without requiring the whole platform.
- Local development should favor realistic Cloudflare bindings where practical so preview and production behavior are not surprising.
- Local Postgres should run through Docker Compose with scripts for migrate, reset, and seed.
- Local storage should use Wrangler/R2 development bindings where practical.
- Local authentication should use a real development WorkOS configuration or the repo's WorkOS-compatible local harness rather than a bespoke mock auth system.
