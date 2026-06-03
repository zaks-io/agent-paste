# Deploy-Time Secret Injection and Runtime-Minted Smoke Auth

Status: Accepted. The symmetric-secret + deploy half is implemented (`scripts/deploy.mjs`, `secrets.required`, `lib/secret-routing.mjs`); the WorkOS M2M smoke half is implemented in code and pending operator wiring of the M2M credentials.

[ADR 0058](./0058-first-deploy-schema-and-secret-bootstrap.md) chose "a checked-in TypeScript script for secrets" whose push path is per-secret `wrangler secret put`, with values captured once into a password manager. That decision was right for a first deploy. It does not survive contact with steady-state operations, and the divergence is now the single biggest source of operational pain in the project: hosted smoke tests fail on authentication, and diagnosing them devolves into "what the fuck is this secret, does the value in CI match the value on the Worker?" — a question that, by design, **cannot be answered**, because Worker secret values are write-only.

This ADR records the model that ends that problem. It is built entirely on **native Cloudflare Wrangler primitives plus a WorkOS-supported grant** — no new vendor, no second IaC state file (consistent with 0058's rejection of Terraform/Pulumi for this MVP). It amends 0058's push path and supersedes the ad-hoc `set-*-secret.mjs` script sprawl that grew up around it.

## The problem, precisely

A single logical secret (e.g. `SMOKE_HARNESS_SECRET`) exists today as **multiple independently-authored copies**:

- the Worker secret, written by `scripts/bootstrap-secrets.mjs` via `putWorkerSecret` (write-only; unreadable after set),
- a GitHub Actions secret, pasted in by hand, separately,
- optionally a developer `.env`.

Three writers, no reader. Nothing can compare them. The failure mode chain:

1. **Drift is invisible.** Worker values cannot be read back ([Cloudflare docs](https://developers.cloudflare.com/workers/configuration/secrets/): "secret values are not visible within Wrangler or Cloudflare dashboard after you define them"). So a CI-vs-Worker mismatch presents only as a downstream `401`, never as a diff.
2. **"Fixing" it makes it worse.** `bootstrap-secrets.mjs` _generates_ on every run (`secretBytes()`). Re-running to "resync" mints a _new_ value, invalidating every consumer the operator did not also update by hand. This is the documented over-rotation footgun (see memory: "Don't re-add the authed smoke or rotate the pepper to fix a smoke 401").
3. **Routing is duplicated.** Which secret binds to which Worker is encoded in `bootstrap-secrets.mjs` _and_ re-encoded across six `scripts/set-*-secret.mjs` scripts. Those can disagree.
4. **The WorkOS leg stores the wrong thing.** Authed and MCP smokes need a WorkOS access token. The token is **pre-minted and stored** in `AGENT_PASTE_EPHEMERAL_SMOKE_WORKOS_ACCESS_TOKEN` / `AGENT_PASTE_MCP_SMOKE_ACCESS_TOKEN`. WorkOS access tokens are short-lived, so the stored value goes stale and every authed assertion either `401`s or silently skips (`allowClaim: Boolean(...token)`). A green check can mean "did not actually test."

The common thread is the universal anti-pattern named by every secrets-management source: **copies of a secret outside its single source of truth.** The fix is not better tracking of the copies. It is to stop having copies.

## What is actually true today

- Each app builds/deploys with `wrangler deploy --config wrangler.jsonc --env <preview|production>` (e.g. `apps/api/package.json`). Before 0078 the standing-deploy orchestrator (`deploy-preview.mjs`, now replaced by `deploy.mjs`) ran `pnpm --filter <app> deploy:<target>` in service-binding order with no secret step, relying on a one-time `bootstrap-secrets.mjs` push.
- The API already validates WorkOS tokens by audience/issuer/JWKS, with **distinct audiences** for CLI, MCP, and web surfaces (`apps/api/src/env.ts`: `WORKOS_CLI_AUDIENCE`, `WORKOS_MCP_AUDIENCE`, plus matching `*_ISSUER` / `*_JWKS_URL`). The token-validation surface is already there; only the _minting_ of a test token is missing.
- Secret routing (pre-0078) lived in `bootstrap-secrets.mjs`'s `workerSecrets` map and was mirrored by `set-content-signing-secret.mjs`, `set-upload-signing-secret.mjs`, `set-stream-internal-secret.mjs`, `set-artifact-bytes-encryption-secret.mjs`, and the rotation setters — duplication this ADR collapses into `lib/secret-routing.mjs`.

## Decision

### 1. The app declares the secrets it requires — `secrets.required` in `wrangler.jsonc`

Each Worker's config declares the secret names it needs. `wrangler deploy` and `wrangler versions upload` **fail with a clear error before deploying** if any are missing. This is the "bake the identity into the app" instinct done correctly: the app is the authority on _what it requires_, enforced at deploy time, not discovered at runtime via a `401`. It replaces the implicit, scattered routing in the scripts with a per-Worker, in-repo, reviewed declaration.

### 2. One command applies all secrets and deploys — `scripts/deploy.mjs`

`scripts/deploy.mjs <local|preview|production>` is the single entrypoint (the per-app `deploy:<target>` package scripts and the production workflow call it). For each consuming Worker it lists the secret **names** already present (`wrangler secret list` — values are never readable), provisions only the **missing** secrets, and deploys every Worker in dependency order. Provisioning generates random symmetric values **in memory** and pipes them to `wrangler secret bulk` over **stdin** — no value is ever printed or written to disk in cleartext. A value supplied via the environment (`PRODUCTION_<NAME>`/`PREVIEW_<NAME>`, i.e. GitHub environment secrets) takes precedence over generation, which is how provider-issued values reach the Workers.

It is **idempotent**: a secret already on the Worker is left untouched, so re-running never rotates anything and is always safe. Routing — which secret binds to which Worker — is the single source of truth in `scripts/lib/secret-routing.mjs`, and the same data backs each Worker's `secrets.required`, so config and application can't disagree.

Consequence: **the Worker's secrets are reconciled from one routing definition on every deploy.** "Which Worker is missing which secret, and does it match?" stops being a manual question — a missing required secret fails the deploy by name (`secrets.required`), and the binding set is mechanical.

### 3. Smoke reads the same source

The smoke job sources its symmetric secrets (e.g. `SMOKE_HARNESS_SECRET`) from the **same** GitHub-environment-scoped values available to the deploy. Same `${{ secrets.* }}` reference; same value by construction.

### 4. The WorkOS leg stores the durable secret and mints the perishable one at test time — M2M `client_credentials`

Stop storing WorkOS _access tokens_. Create a WorkOS **M2M application** and store only its **`client_secret`** (long-lived, non-expiring) in the secret store. The smoke job mints a fresh short-lived access token per run:

```http
POST https://<subdomain>.authkit.app/oauth2/token
Content-Type: application/x-www-form-urlencoded
grant_type=client_credentials&client_id=<id>&client_secret=<secret>[&scope=...]
```

The minted token carries an `org_id` claim and is validated by the API's existing WorkOS JWKS path. This is the textbook split — store the durable credential, mint the perishable one on demand — and it permanently ends the expired-token `401`/silent-skip cycle. Token validity can be checked via WorkOS Token Introspection if needed.

The smoke's silent-skip semantics are also corrected: with minting in place, the authed/MCP/claim assertions **run on every CI run**. Skips become loud and exceptional, not the default.

## Considered options

- **Hand-rolled `secrets.mjs apply <env>` + a `SECRET_ROUTING` table + a committed fingerprint manifest.** A single source file, one idempotent apply that diffs-before-write, rotation held as a separate verb. This is a worse re-implementation of `--secrets-file` (atomic deploy-time injection) + `secrets.required` (the routing/requirement declaration). It keeps a bespoke push path the project would own and maintain. Rejected in favor of the native primitives.
- **A secrets manager as source of truth (Doppler / Infisical / Cloudflare Secrets Store).** The textbook "one store, pulled at runtime" answer, with first-class Workers + GitHub + CLI integration and a clean `<tool> run --` for "give me everything for this session." Genuinely better at scale and the likely _next_ step. Deferred this pass to avoid a new vendor/dependency while the cheaper native primitives already eliminate the drift class. Revisit when secret count or operator count grows.
- **Terraform / Pulumi for secret state.** Already rejected by [ADR 0058](./0058-first-deploy-schema-and-secret-bootstrap.md) for this MVP (state file to protect; values either live in state or are passed out-of-band). Unchanged.
- **An operator-gated `/config-identity` hook reporting secret version + fingerprint.** Improves _visibility_ into drift but does not _prevent_ it, and adds an information-leak surface to gate. Useful debug affordance, not a fix. Deferred; if added later it must be operator-gated in all environments.
- **One deploy command (`scripts/deploy.mjs`) reconciling secrets via `wrangler secret bulk` over stdin, generate-if-missing, + `secrets.required` + WorkOS M2M (chosen).** Native, no new vendor, one routing definition drives both config and application, idempotent so re-running is safe, and it fixes the perishable-token leg at its root. (`wrangler deploy --secrets-file` is an equivalent native primitive; piping `secret bulk` over stdin was chosen so no cleartext secrets file is written to disk and so generate-if-missing can be expressed directly.)

## Consequences

- **[ADR 0058](./0058-first-deploy-schema-and-secret-bootstrap.md) is amended.** Its "push path" (per-secret `wrangler secret put`) is superseded by `scripts/deploy.mjs` reconciling secrets on every deploy for steady-state. `bootstrap-secrets.mjs` is narrowed to a _generator of new random values_ for first deploy; it no longer owns the per-Worker push, and it stops being a thing operators run to "resync." Re-running the generator remains destructive and gated, exactly as 0058 states.
- **The `set-*-secret.mjs` scripts are retired.** `set-content-signing-secret.mjs`, `set-upload-signing-secret.mjs`, `set-stream-internal-secret.mjs`, and `set-artifact-bytes-encryption-secret.mjs` (and their shared `lib/shared-secret-setter.mjs`) existed only to push one shared secret to its consumers out-of-band. `scripts/deploy.mjs` (generate-if-missing, binds every secret to its consumers each deploy) + `secrets.required` subsume them. Their routing knowledge moved into `lib/secret-routing.mjs` and each Worker's `secrets.required`.
- **[ADR 0045](./0045-secret-rotation-cadence-and-on-demand-tooling.md) is unaffected.** Rotation cadence and the `rotate-versioned-secret.mjs` / `rotate-workos-secrets.mjs` tooling stand unchanged — `deploy.mjs` is generate-if-missing and deliberately does not rotate. The `V1`/`V2` overlap discipline is unchanged.
- **WorkOS gains an M2M application per environment.** Its `client_secret` becomes a stored secret; the access token is never stored. The API's existing WorkOS audience/issuer/JWKS validation accepts the minted token (an audience/scope decision for the smoke surface is a follow-up detail, not an architectural change).
- **Smoke auth becomes deterministic.** Symmetric secrets match by construction; the WorkOS token is fresh per run. The `if (target !== "production")` skip in `smoke-hosted.mjs` for destructive checks is a _separate_ prod-safety decision and is out of scope here.

## Done

Verifiable outcomes for the implementation that follows this ADR:

1. Every secret-consuming Worker's `wrangler.jsonc` declares `secrets.required` for the secrets it hard-requires, sourced from `lib/secret-routing.mjs`; a deploy missing a required secret fails at `wrangler deploy` with a named error. (Done: declared on api/upload/content/jobs/stream/web; mcp requires none.)
2. `scripts/deploy.mjs <local|preview|production>` is the single deploy/secret-application command; `deploy:preview`/`deploy:production` and `deploy-production.yml` call it; no `set-*` script remains. Secrets are bound via `wrangler secret bulk` over stdin (no cleartext file), generate-if-missing, idempotent. (Done.)
3. The four `set-*-secret.mjs` scripts and `lib/shared-secret-setter.mjs` are deleted with their tests; `bootstrap-secrets.mjs` is generator-only and points operators at `deploy.mjs`. (Done.)
4. A WorkOS M2M application exists for each environment; only its `client_secret` is stored. `smoke-hosted-ephemeral.mjs` and `smoke-mcp.mjs` mint a fresh access token via `client_credentials` (`lib/workos-m2m.mjs`) and prefer it over any stored `*_WORKOS_ACCESS_TOKEN`. (Code done; the M2M apps + `AGENT_PASTE_*_WORKOS_M2M_*` secrets are operator console/secret wiring.)
5. The authed/MCP/claim assertions execute (not skip) on a clean CI run once the M2M credentials are wired, proven by the smoke output showing the authenticated summary rather than the "Skipped" line.
6. `pnpm verify` passes; secret-script unit tests are updated or removed to match the retired scripts, and `lib/secret-routing`, `lib/secret-values`, `lib/local-env-secrets`, `lib/workos-m2m` have unit coverage. (Done.)
