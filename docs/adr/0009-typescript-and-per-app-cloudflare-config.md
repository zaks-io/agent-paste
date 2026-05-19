# TypeScript and Per-App Cloudflare Config

All application and package code will be written in TypeScript and use ESM by default. Each deployable app owns its own Cloudflare configuration, bindings, environment-specific settings, and deployment script rather than relying on a single global Worker configuration.

## Consequences

- Shared compiler settings should live in `packages/tsconfig`.
- Apps should keep their own Wrangler configuration and environment bindings.
- Shared `packages/config` should provide typed environment parsing helpers, not hidden global runtime state.
- Packages should be ESM-only unless a specific package has a proven need for another module format.
