# Hosted Ops

Last updated: 2026-05-26.

## Environment

- Cloudflare account id: `a461d640900eb3905d7b6619c8c0da91`.
- Domain: `agent-paste.sh` on Cloudflare nameservers.
- Neon project: `still-forest-91029005`.
- GitHub org/repo: `zaks-io/agent-paste`.
- npm org/package: `@zaks-io/agent-paste` is reserved as a public placeholder
  package for CLI distribution; the installed command remains `agent-paste`.

## Deployed / Routed Workers

| Worker surface | Current status                                                                                |
| -------------- | --------------------------------------------------------------------------------------------- |
| `apex`         | Marketing/apex route live at `agent-paste.sh`.                                                |
| `api`          | Preview/production deployed; owns control plane, web APIs, admin APIs, scheduled MVP cleanup. |
| `upload`       | Preview/production deployed; owns upload sessions and R2 writes.                              |
| `content`      | Preview/production deployed; owns `usercontent` content reads.                                |
| `web`          | Preview and production deployed at `app.preview.agent-paste.sh` and `app.agent-paste.sh`.     |
| `jobs`         | Scaffolded only; not a business-critical deployed surface yet.                                |
| `mcp`          | Scaffolded only; not a business-critical deployed surface yet.                                |

## Secrets

`scripts/bootstrap-secrets.mjs` writes MVP secrets and optional web secrets. Use
`--with-web` only when all WorkOS inputs are available.

| Secret                   | Bound on             | Notes                                                                                          |
| ------------------------ | -------------------- | ---------------------------------------------------------------------------------------------- |
| `CONTENT_SIGNING_SECRET` | api, upload, content | Active content-token and Agent View signing secret.                                            |
| `UPLOAD_SIGNING_SECRET`  | upload               | Active upload PUT token signing secret.                                                        |
| `API_KEY_PEPPER_V1`      | api, upload          | Active API-key/admin-token HMAC pepper.                                                        |
| `ADMIN_TOKEN`            | operator only        | Printed once; store in password manager.                                                       |
| `ADMIN_TOKEN_HASH`       | api                  | HMAC of `ADMIN_TOKEN`.                                                                         |
| `OPERATOR_EMAILS`        | api, web             | Operator allowlist, written as a Worker secret today.                                          |
| `WORKOS_API_KEY`         | api, web             | WorkOS server-side API credential.                                                             |
| `WORKOS_CLIENT_ID`       | api, web             | Also kept in Wrangler vars as non-secret deployment metadata/placeholders.                     |
| `WORKOS_COOKIE_PASSWORD` | web                  | WorkOS AuthKit sealed-session password.                                                        |
| `WORKOS_CLI_AUDIENCE`    | api                  | WorkOS User Management audience used to verify CLI/login and dashboard session issuer details. |

Deferred secrets not created for the current app:

- `ACCESS_LINK_SIGNING_KEY_V1` - waits for Phase 4 Access Links.
- Application encryption root keys - wait for Phase 6 app-layer encryption.
- Stripe secrets/webhook secret - wait for post-launch billing.

## GitHub / CI

- `TURBO_TOKEN`, `TURBO_TEAM`, `TURBO_REMOTE_CACHE_SIGNATURE_KEY`,
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `PRODUCTION_DATABASE_URL`,
  `NEON_API_KEY`, `NEON_PROJECT_ID`, `CLOUDFLARE_WORKERS_SUBDOMAIN`, and
  `AGENT_PASTE_PRODUCTION_ADMIN_TOKEN` are present or proven by successful
  workflows.
- `NEON_PRODUCTION_BRANCH_ID` is optional safety metadata and not active.
- `NPM_TOKEN` is needed for future real CLI releases; the npm namespace is
  already reserved by `@zaks-io/agent-paste@0.0.0`.
- GitHub Production required-reviewer/wait-timer/admin-bypass posture is parked.

## Deploy Order

1. `pnpm setup:codex`
2. `pnpm verify`
3. `pnpm smoke:local`
4. Address the active backlog item, or document why it is deferred.
5. For runtime changes: `pnpm migrate:preview && pnpm deploy:preview && pnpm smoke:preview`
6. Same-repo PRs exercise the PR preview workflow automatically.
7. Production deploy only with explicit Isaac approval:
   `pnpm migrate:production && pnpm deploy:production && pnpm smoke:production`

## Open Ops Items

- Harden PR-preview readiness against workers.dev route propagation flakes.
- Add docs-only path filtering to PR preview deploy.
- Add Lighthouse a11y gate.
- Separate Hyperdrive runtime and migration roles.
- Restrict migration URL secrets to migration workflows.
- Wire Logpush -> Axiom when Isaac is ready for Cloudflare/Axiom click-ops.
- Revisit GitHub Production environment reviewer/wait-timer/admin-bypass posture.
