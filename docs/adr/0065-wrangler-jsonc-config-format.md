# Wrangler Configuration in JSONC, Not TOML

Refines [ADR 0009](./0009-typescript-and-per-app-cloudflare-config.md). Every deployable app's Cloudflare configuration is committed as `wrangler.jsonc` (JSON with comments). The TOML alternative is not used for new apps. ADR 0009 fixed per-app ownership and the principle that each app owns its bindings; this ADR fixes the file format and the schema-binding it depends on.

## Considered Options

- **TOML (`wrangler.toml`).** The original Wrangler default. Compact for simple cases and supports the `[env.production]` table style. Rejected because the public JSON Schema Cloudflare ships for Wrangler is JSON-first, so editor validation against TOML lags the schema; some TOML formatters strip or mangle comments; and `[[ratelimits]]`/`[[d1_databases]]`/`[[kv_namespaces]]` array-of-objects sections become harder to template programmatically than JSON.
- **Plain `wrangler.json`.** Schema-validated, but loses inline comments. Comments matter here because per-binding rationale ("this KV namespace is the denylist per [ADR 0057](./0057-kv-denylist-namespace-keys-and-write-order.md)", "this ratelimit binding is the actor cap per [ADR 0064](./0064-native-ratelimit-bindings-for-authenticated-counters.md)") is exactly the kind of provenance note that should live next to the binding it explains.
- **`wrangler.jsonc` (chosen).** Schema-validated, supports `// inline rationale` next to bindings, and is what `wrangler init` produces for new Workers in current Wrangler releases. The format also lines up with `tsconfig.json` and `biome.jsonc` already in the repo, so editors apply one JSONC mental model across the workspace.

## Consequences

- Every app under `apps/*` (`api`, `upload`, `content`, `jobs`, `web`, `mcp`) commits a `wrangler.jsonc` next to its `package.json`. ADR 0009's per-app ownership is unchanged; this ADR fixes only the format.
- The file declares a `$schema` pointer at the top so editor IntelliSense binds to the Wrangler version the workspace pins. The schema pin moves with `wrangler` in the pnpm catalog; there is no separate version to drift.
- Inline comments are reserved for binding rationale that ties config back to ADRs and `CONTEXT.md`. Example: `// denylist per ADR 0057 — content reads, api and jobs write`. Keep them brief; do not narrate code.
- Per-environment overrides use the JSONC `env: { production: { ... } }` nesting form rather than TOML's `[env.production]` table form. This is the documented Wrangler shape for the JSON family of configs.
- The `wrangler types` generator from ADR 0009 reads `wrangler.jsonc` and writes per-app `worker-configuration.d.ts`. The format change does not change the generator contract.
- Secret values still live outside the file: `wrangler secret put` for deployed environments, `.dev.vars` for local dev per `docs/specs/local-dev.md`. ADR 0009's prohibition on secrets in committed config is unchanged.
- Scaffold starts at JSONC; there is no `wrangler.toml` to migrate. If a TOML file appears later through copy-paste, the convention is to convert at touch time, not to maintain a mixed-format tree.

### What this ADR does not change

- ADR 0009's per-app ownership rule, the per-app `worker-configuration.d.ts` output, the prohibition on global Worker config, or the secret-handling rules.
- Any binding contract already specified by existing ADRs — KV bindings per ADR 0057, R2 bindings per ADR 0021 / ADR 0027 / ADR 0028, Hyperdrive bindings per ADR 0005, Queue bindings per ADR 0049, rate-limit bindings per ADR 0064.
- The local-dev multi-Worker `--persist-to` rule from `docs/specs/local-dev.md`. The `pnpm dev:all` invocation passes `-c apps/*/wrangler.jsonc` paths in the same way it would have passed `.toml` paths.
