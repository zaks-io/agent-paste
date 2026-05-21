# MVP Bootstrap Checklist

What I (the implementing agent) need from you (Isaac) before I can build out Phase 1 of `docs/specs/mvp.md`. Written from the perspective of starting today against the current scaffold (`packages/contracts` + empty `apps/*` and `packages/*`).

Goal: take this list end-to-end, paste the resulting IDs / secrets / decisions into the marked places, and I should be able to land the MVP without coming back to you for prerequisites.

Items are grouped by category. Sections marked **Blocking** stop implementation; **Decide** are spec gaps I'll need answered before the first code lands; **Defer** are things I'm explicitly NOT going to ask you for in the MVP.

---

## 1. Cloudflare account — Blocking

I need write access to a Cloudflare account that hosts everything (Workers, R2, KV, Hyperdrive, DNS).

- [X] **Workers Paid plan.** Required for: scheduled handlers (cleanup), Hyperdrive, KV writes at the MVP rate, R2 class B ops. Free tier won't fit.
- [ ] **Account ID.** Paste here: `__________`
- [ ] **API token** scoped to: `Workers Scripts: Edit`, `Workers Routes: Edit`, `Workers KV Storage: Edit`, `Workers R2 Storage: Edit`, `Hyperdrive: Edit`, `Account Settings: Read`, `Zone Settings: Read`, `DNS: Edit` (for the `agent-paste.sh` zone). Paste into a GitHub repo secret named `CLOUDFLARE_API_TOKEN`.
- [ ] **Confirm I can run `wrangler whoami` locally** and that you've authenticated `wrangler` once on the machine I'm running on. (Already verified `2026-05-20`: account `a461d640900eb3905d7b6619c8c0da91`, wrangler 4.61.1.)
- [ ] **Verify `Hyperdrive: Edit` scope on the active OAuth token.** Your current token has `connectivity (admin)` which *may* cover Hyperdrive; if `wrangler hyperdrive create` errors with a permissions message, re-auth with `wrangler login` and explicitly grant the Hyperdrive scope.

If the account is shared with other projects, name the prefix you want me to use for resources (default I'll pick: `agent-paste-`).

---

## 2. Domain — Blocking

`docs/adr/0014` pins `agent-paste.sh` as the apex with four subdomains.

- [X] **`agent-paste.sh` registered** and pointed at Cloudflare nameservers. Confirm: yes / no
- [ ] If no, register it (Cloudflare Registrar or external) and move DNS to Cloudflare. Until this is true I cannot deploy preview, only run local dev.
- [ ] Confirm I'm allowed to claim these subdomains now (all named by ADRs 0014 + 0047):
  - `api.agent-paste.sh`, `upload.agent-paste.sh`, `usercontent.agent-paste.sh` (live)
  - `api-preview.agent-paste.sh`, `upload-preview.agent-paste.sh`, `usercontent-preview.agent-paste.sh` (preview shape `{x}-preview.agent-paste.sh` follows ADR 0047 line 49's `app-preview.agent-paste.sh` convention)

DNS records and Worker routes will be created by me through `wrangler.jsonc`; you don't need to click in the dashboard.

---

## 3. Postgres on Neon — Blocking

Provider chosen: **Neon** (only candidate that passes all of: Hyperdrive first-class, `CREATE ROLE BYPASSRLS` allowed, O(1) copy-on-write branching for per-PR previews per ADR 0007, free tier covers the MVP, no extras we don't want). Decision rationale recorded in commit history; see `docs/adr/` for any future re-eval.

Walk-through (in the Neon console):

- [ ] **Create Neon project.** Name: `agent-paste`. Region: `__________` (recommend `aws-us-east-1` unless you have EU latency reasons — Cloudflare Workers run everywhere; the DB region only matters for the tail of unhandled cache misses).
- [ ] **Create live branch.** Neon's default `main` branch is your `live` environment. Don't touch it directly; CI migrations will.
- [ ] **Create preview branch** off `main`, named `preview`. This is the shared preview env per §8d. Per-PR ephemeral branches come later, off this one.
- [ ] **Create the `hyperdrive-user` role** per [Neon's Hyperdrive guide](https://neon.com/docs/guides/cloudflare-hyperdrive). Copy the generated password — it shows once.
- [ ] **Grab connection strings** from the Connection Details pane. Uncheck the pooled-connection box (Hyperdrive does its own pooling). Two strings:
  - Live (against `main` branch, `hyperdrive-user` role): `__________`
  - Preview (against `preview` branch, `hyperdrive-user` role): `__________`
- [ ] **Capture a `neon_superuser` connection string for both branches.** Only used once, by the first Drizzle migration that creates `app_role` and `platform_admin`. Goes straight into the GitHub Environment secret in §5, never committed.
- [ ] **Project ID.** Paste here so I can drive branch creation from CI in Phase 2: `__________`
- [ ] **Autoscaling.** Leave at free-tier 0.25 CU fixed for MVP. Enable autoscaling later if live traffic ever sustains > free tier; requires Launch plan ($5/mo minimum).

I'll generate `app_role` (`NOBYPASSRLS`, used by Hyperdrive) and `platform_admin` (`BYPASSRLS`, used by migrations) inside the first Drizzle migration. You don't need to create them manually.

---

## 4. Cloudflare resources — Mostly self-serve, one decision

I can create these with `wrangler` once I have the account, but you'll want to know what gets created.

- [ ] R2 buckets: `agent-paste-live` and `agent-paste-preview`. Name OK? `__________`
- [ ] KV namespaces for the denylist (`docs/adr/0057`): one per env, bound name `DENYLIST`. I'll name them `agent-paste-denylist-live` / `-preview`.
- [ ] Hyperdrive configs: one per env, pointing at the connection strings above. I'll record IDs in `apps/*/wrangler.jsonc`.
- [ ] Native rate-limit bindings (`docs/adr/0064`): I'll add `ACTOR_RATE_LIMIT` and (decision below) `WORKSPACE_BURST_CAP` to `apps/api` and `apps/upload`.

Cloudflare Queues are explicitly out of MVP (jobs spec says scheduled handler in `api` owns cleanup). I will not add a Queue binding.

---

## 5. GitHub repo secrets — Blocking for deploy, not local dev

CI/CD pulls from these. Current state (verified `2026-05-20`):

- **Repo level:** 0 secrets, 0 variables, 0 environments.
- **Org level (`zaks-io`, inherited by this repo):** already set — `CLOUDFLARE_ACCOUNT_ID`, `TURBO_TOKEN` (secrets); `TURBO_TEAM=zaks-io` (variable). Also present but not needed for MVP: `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `LINEAR_API_KEY`, `SNYK_TOKEN`, and three `*AUTH0_DOMAIN=auth0.zaks.io` vars (relevant in Phase 3 when web/admin Auth0 lands).

Required for CI (per `ci.yml`):

- [x] `TURBO_TOKEN` — inherited from org
- [x] `TURBO_TEAM` — inherited from org (`zaks-io`)
- [ ] `TURBO_REMOTE_CACHE_SIGNATURE_KEY` — not at org or repo. Add as repo secret (signing key should be per-project, not shared across the org).

Required for deploy:

- [x] `CLOUDFLARE_ACCOUNT_ID` — inherited from org
- [ ] `CLOUDFLARE_API_TOKEN` — must be repo-scoped because the token scopes need DNS:Edit on the `agent-paste.sh` zone only. Don't reuse an org-wide CF token even if you have one.
- [ ] `DATABASE_URL_MIGRATIONS_LIVE` — Neon `neon_superuser` conn string against `main`, only used by the migrations job. Repo secret, scoped to the `live` environment.
- [ ] `DATABASE_URL_MIGRATIONS_PREVIEW` — Neon `neon_superuser` conn string against the `preview` branch. Repo secret, scoped to the `preview` environment.
- [ ] `NPM_TOKEN` — for publishing the CLI later (can wait until first publish). If you publish other packages under `zaks-io`, promote to org secret instead of repo.

I will add GitHub Environments `live` and `preview`, with required-reviewers = you on `live` only, per `docs/adr/0012` and your "CI is the merge gate" preference. Confirm names. OK? `__________`

---

## 6. Bootstrap secrets — I generate, you capture

`scripts/bootstrap-secrets.ts` (per `docs/adr/0058`) doesn't exist yet. I'll implement it as part of the first deploy pass. When you run it, it will print these values **once**. Put them in Bitwarden under collection / folder name: `__________` (ADR 0058's "1Password" reference is stale; capture target is your Bitwarden vault).

| Secret | Bound on | Source |
|---|---|---|
| `CONTENT_GATEWAY_SIGNING_KEY_V1` | `api` (mint), `content` (verify) | generated |
| `API_KEY_PEPPER_V1` | `api` | generated |
| `AGENT_VIEW_SIGNING_KEY_V1` ← see decision §8 | `api` | generated |
| `UPLOAD_PUT_SIGNING_KEY_V1` ← see decision §8 | `upload` | generated |
| `AGENT_PASTE_ADMIN_TOKEN` ← see decision §8 | `api` (admin routes) | generated |
| `OPERATOR_EMAILS` | `api` | you supply |

You supply for `OPERATOR_EMAILS`: comma-separated email allowlist. Default if you don't reply: just yours, `isaac@isaacsuttell.com`. OK? `__________`

`WEB_SESSION_SEAL_KEY_V1` and `ACCESS_LINK_SIGNING_KEY_V1` from `docs/ops/first-deploy.md` are NOT MVP — those are Phase 3 (web) and Phase 4 (access links). I'll skip them.

---

## 7. npm — Decide before CLI ships

Public CLI is the product surface (`docs/specs/mvp.md`).

- [ ] **Package name.** Options:
  - `agent-paste` (unscoped, matches the binary; preferred — confirm it's free on npmjs.com)
  - `@agent-paste/cli` (scoped under an `agent-paste` org you'd need to claim)
  - Something else: `__________`
- [ ] **npm org / scope claimed?** Yes / no. If no, claim before first publish.
- [ ] **2FA on the publishing account.** Required.

This can wait until the CLI is feature-complete locally. Local dev publishes nothing.

---

## 8. ADRs to write before/during implementation

Most §8 decisions below are implementation details (defaults are fine), but five conflict with or extend existing ADRs and deserve their own record. Suggested filenames already follow the `NNNN-kebab.md` convention used in `docs/adr/`.

- [ ] `0066-neon-as-postgres-provider.md` — pins the vendor choice that ADR 0005 left open. Records Hyperdrive integration path, branching model for ADR 0007 previews, BYPASSRLS support for ADR 0044 roles, and Databricks-acquisition risk.
- [ ] `0067-agent-view-signing-key-separate-from-content-gateway.md` (if §8a is taken) — extends ADR 0028. Pins the kid family and rotation rules.
- [ ] `0068-upload-put-url-signing.md` — extends ADR 0027. Pins the signing primitive, what the signed payload covers, and how upload-worker URLs differ from content-gateway tokens.
- [ ] `0069-mvp-admin-bearer-token.md` — scopes ADR 0046 (Cloudflare Access + Auth0 + email allowlist) to post-MVP and records the single-bearer model from `docs/specs/admin.md`. Names the hashing scheme (recommend: same pepper as ADR 0043 API keys).
- [ ] `0070-mvp-preview-environment-is-single-shared.md` — scopes ADR 0007's per-PR-preview rule to Phase 2 and records the single shared `preview` env for MVP. Includes the trigger condition for promoting to per-PR.

I'll draft these alongside the code that implements each. They're not blocking — they're the paper trail.

The pure yes/no decisions in §8 below (auth cache from day one, burst cap from day one, Markdown rendering, title inference, bin name) don't deserve their own ADRs; they're either confirmations of existing ADRs or trivial implementation choices.

## 8. Spec gaps I need answered — Decide

These are places where the spec is internally inconsistent or silent. I'll need a call from you before writing the corresponding code. Defaults marked with **(recommend)**.

### 8a. AgentView token vs content-gateway token

`docs/specs/local-dev.md` lists `AGENT_VIEW_SIGNING_KEY_V1` separately from `CONTENT_GATEWAY_SIGNING_KEY_V1`. No ADR pins this. Pick one:

- [ ] Separate signing key per token family **(recommend — different TTLs, different scopes, different rotation cadences)**
- [ ] Single shared key, distinguished by token-internal scope field

### 8b. Upload-worker PUT URL signing

The upload Worker mints PUT URLs against itself (`upload.agent-paste.sh/v1/upload-sessions/{id}/files/{path}`). No ADR pins the signing primitive. Options:

- [ ] HMAC-SHA-256 with a dedicated `UPLOAD_PUT_SIGNING_KEY_V1`, embedded in a query param **(recommend — mirrors the content-gateway shape and lets me reuse the kid rotation pattern from ADR 0028)**
- [ ] Reuse `CONTENT_GATEWAY_SIGNING_KEY_V1` with scope=`upload_put`

### 8c. Admin token model for MVP

`docs/specs/admin.md` says `Authorization: Bearer ${AGENT_PASTE_ADMIN_TOKEN}` — a single shared bearer. `docs/adr/0046` says operator surfaces are Cloudflare Access + Auth0 + email allowlist. The admin CLI is intentionally pre-Auth0 in MVP. Confirm:

- [ ] **Single shared bearer for MVP.** Stored as `bcrypt` of the secret on the `api` Worker (or HMAC + pepper like API keys). No Cloudflare Access in front. ADR 0046's web admin path is deferred to Phase 3. **(recommend — matches admin.md, matches "no dashboard in MVP")**
- [ ] Add Cloudflare Access in front of `/admin/*` from day one (you'd need to configure Access policies and an `AGENT_PASTE_ADMIN_TOKEN` for the agent-driven case)

If single-bearer: pick storage shape: hashed with the same pepper as API keys (`recommend`), or its own secret.

### 8d. Preview environments — per-PR or single shared?

`docs/adr/0007` says per-PR previews with per-PR Postgres schemas. That's real implementation work (PR-open / PR-close workflows, schema cleanup janitor). For MVP:

- [ ] **Single shared `preview` env per ADR 0012, no per-PR isolation.** Per-PR previews land in Phase 2. **(recommend — keeps the first deploy small)**
- [ ] Per-PR previews from day one

### 8e. Auth cache (ADR 0062) from day one?

ADR says "Hot-path lookups in `api`, `upload`, and `content` adopt the two-layer pattern from day one." Confirm:

- [ ] Yes, ship `packages/auth`'s `cachedLookup` in MVP **(recommend — ADR is explicit, refactoring later is harder than the ADR notes)**
- [ ] No, defer to Phase 2

### 8f. Workspace burst cap in MVP?

ADR 0064 adds two rate-limit bindings (`ACTOR_RATE_LIMIT` and `WORKSPACE_BURST_CAP`). MVP only mentions the 60 rpm actor cap. Confirm:

- [ ] Both bindings from day one **(recommend — they're free in `wrangler.jsonc`, and ADR 0064 wants them together)**
- [ ] Just `ACTOR_RATE_LIMIT`, add burst later

### 8g. Markdown/text rendering in MVP?

`mvp.md` says "Secondary support is allowed only when cheap" and `phases.md` defers Markdown renderer to Phase 2. Confirm I should:

- [ ] Accept `.md`/`.txt` uploads, serve as `text/plain` / `text/markdown` with no rendering **(recommend — matches `content-rendering.md`)**
- [ ] Add a Markdown→HTML renderer page in MVP

### 8h. Title inference rule for `agent-paste publish ./site`

`mvp.md` says CLI "infers the title when `--title` is omitted" but doesn't say from what. Pick one:

- [ ] Basename of the publish path (folder name, or HTML file name minus `.html`) **(recommend)**
- [ ] `<title>` element from the entrypoint HTML
- [ ] Default literal `"untitled"`

### 8i. Stable binary name for `agent-paste`

CLI binary lives at `apps/cli`. Confirm:

- [ ] Bin name: `agent-paste` (npm package name and binary name match) **(recommend)**
- [ ] Different: `__________`

---

## 9. What I am explicitly NOT going to ask you for in MVP

Recording these so we don't accidentally re-scope:

- Auth0 tenant, applications, audiences — Phase 3.
- MCP server / OAuth DCR — Phase 5.
- Web dashboard, Access Link viewer, operator UI — Phase 3/4.
- Cloudflare Queues + DLQ — Phase 4.
- App-layer byte encryption (`docs/adr/0063`) — Phase 6.
- Real safety scanner — Phase 6.
- Stripe/billing — Phase 6.
- `WEB_SESSION_SEAL_KEY_V1` and `ACCESS_LINK_SIGNING_KEY_V1` — out of MVP per the deferred phases.
- Per-PR preview Cloudflare resources, if you pick the single shared preview env in §8d.
- A second admin identity / Auth0 M2M for the rotation agent (ADR 0046) — MVP rotates manually.

If any of those creep in, that's a separate ask.

---

## 10. First deploy order, for context

Once §1–§7 are unblocked I will deploy in this order. You don't need to do anything here; this is just so you know what's coming and can stop me at the right point per your "Never deploy to production without explicit approval" rule.

1. **Local-only loop.** Wire `packages/db` + `packages/contracts` + `apps/api` + `apps/upload` + `apps/content` against `wrangler dev --persist-to` + a local Postgres (Docker) until `docs/specs/local-dev.md` smoke test passes.
2. **Preview deploy.** First real Cloudflare deploy. Uses §3 preview DB, §4 preview R2/KV, §5 GitHub secrets. I will pause before this step and confirm with you.
3. **Live deploy.** Same, against live resources. I will pause and require explicit "go" from you per your global instruction.

---

## Done definition for this checklist

This checklist is satisfied when:

- All `[ ]` checkboxes above the "explicitly NOT" section are checked or have a written decision.
- Bootstrap secrets are captured in your password manager.
- GitHub repo secrets/env vars listed in §5 exist and are non-empty.
- The Cloudflare account + Postgres provider + domain are reachable from a fresh `wrangler` install.

At that point I can start implementing without asking another setup question.
