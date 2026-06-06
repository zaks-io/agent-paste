# Identity Travels In The Token, Authorization Stays In Our Database

Status: Accepted. Extends [ADR 0079](./0079-mcp-scopes-derived-from-member-role-not-workos-token.md) (does not reverse it) and [ADR 0068](./0068-workos-authkit-for-web-app-auth.md). Concerns the authenticated request path for the web app and the `api` Worker. Motivated by AP-256 (web navigation latency).

## Context

AP-256 began as "authed dashboard navigation feels slow (1–3s)." We measured it against Axiom (`cloudflare` otel.traces) before changing anything, and the headline number turned out to be misattributed. The dominant cost is **cold-isolate + cold Hyperdrive→Postgres connection warmup** — every authed `/v1/web` route floors at ~1s and spikes to ~2.7s, _identically on preview and production_, because neither environment has continuous traffic yet (pre-launch: ~20 hits/day). When an isolate happens to be warm, the same routes serve in 1–171ms. That warmup cost resolves itself with real traffic; it is a no-traffic-yet artifact, not a launch-time user problem, and there is no infra knob to turn for it (Neon autosuspend is already `0`/never on all computes, Hyperdrive query caching is already on).

The one real, always-present per-request cost the measurement isolated: `api` calls `GET /user_management/users/{id}` against the WorkOS API (~100ms p50) on **every** authed request, purely to read the user's **email**. JWT verification itself is already cheap — the JWKS is cached at module scope in `packages/auth/src/workos.ts` with a one-hour `cacheMaxAge`, a one-time cost per cold isolate, not per request.

While scoping the fix, a larger question surfaced and is the lasting subject of this ADR: **where should the authorization decision live** — in the WorkOS token (via WorkOS's RBAC `permissions` claim) or in our own database? The answer determines whether WorkOS becomes our org/team/authorization authority or stays purely an identity provider.

## The roles / scopes / permissions distinction

These three were repeatedly conflated. They are different things and this ADR fixes the names in one place:

- **Role** (`role` / `roles`, a native WorkOS claim). Platform identity: "is this person an operator." The only consumer is `isOperator()` in `apps/api/src/operator.ts` (`role === "admin"`). WorkOS is and remains the source of truth for this. It is correctly in the token because it is a fact about the person at the platform level, set by hand for a tiny operator set.

- **Scope** (`workspace_members.scopes`, our column: `["publish","read","admin"]`, `Scope` enum in `packages/contracts/src/enums.ts`). In-**workspace** authorization: what a member may do to artifacts in their workspace. Enforced universally by `hasScopes()` in `packages/worker-runtime/src/registrar-request.ts` against each route contract's required scopes. Today every member is provisioned the full set (`DEFAULT_MEMBER_SCOPES`, `packages/db/src/repository/shared.ts`) because a workspace has exactly one member (ADR 0055). **This column is not vestigial — it is the deliberate seam for multi-member workspaces.** That intent was never written down, which is why it kept reading as dead weight; this ADR records it.

- **Permission** (`permissions`, a native WorkOS RBAC claim). WorkOS's own per-role permission system. **We do not use it.** ADR 0079 considered and rejected sourcing authorization from this claim, because it couples our authorization model to per-environment WorkOS configuration kept in sync by hand — the exact configuration drift that made the ADR 0079 defect hard to diagnose. That rejection stands.

## Decision

**Identity travels in the token. Authorization stays in our database.**

1. **The WorkOS access token carries the member's email.** Via a JWT Template on the WorkOS dashboard client, the token carries a custom claim `zaks-io:email`. Email is immutable per user and is the only thing the per-request WorkOS user fetch existed to retrieve. The namespaced prefix (`zaks-io:`) marks it as ours, distinct from WorkOS-native claims (`iss`, `sub`, `role`, `permissions`). The claim key is referenced through a single constant in `packages/auth`.

2. **Authorization stays in `api` / our database.** `scopes` remain a column on the member row. We own workspaces, membership, and the who-can-do-what decision. We do not put authorization in the token and do not read WorkOS `permissions`. This preserves ADR 0034 (`api` is the authorization + RLS authority for every actor surface) and ADR 0079 (scope source is the member, not the token).

3. **Operator status stays the WorkOS `role` claim.** Unchanged.

4. **The claim is the fast path; the user fetch is the fallback.** When `zaks-io:email` is present on a verified token, the resolver takes the email from the claim (the verified `sub` is the authoritative user id) and **skips `fetchWorkOsUser` entirely**. When absent — CLI and MCP tokens come from separate WorkOS clients without this template — the resolver falls back to the existing user fetch, which also guards `user_id_mismatch`. This keeps CLI and MCP working unchanged; only the web/dashboard path gets the fast claim.

### Scope: email only

We deliberately did **not** also mint our `workspace_id` into WorkOS user metadata (which would have let `api` skip the authorization DB lookup too). See "Considered and dropped" below — the measurement showed that lookup is noise against the warmup floor, and minting it would have added the codebase's first WorkOS _write_ call plus a backfill for already-provisioned users. The email claim is the whole change.

## Why not WorkOS organizations + permissions (the considered alternative)

The genuinely viable alternative was to make a **workspace a WorkOS organization** (1:1), use WorkOS org memberships for invites and WorkOS roles/permissions for access, and read the `permissions` claim from the token. This is a legitimate, well-trodden B2B pattern and would buy invites / SSO / directory sync largely for free later.

Rejected because it is overbuilding for this product. It commits us to WorkOS as the org/team/authorization platform, makes every workspace-permission change a round-trip to per-environment WorkOS config (the ADR 0079 drift scar), and turns our workspace from a value we own into a mirror of a WorkOS object. We own the workspace model; authorization belongs with the resource owner. If the product ever becomes team/seat oriented, this decision is revisited deliberately at that point — not pre-committed now.

## Considered and dropped: workspace_id in token metadata

An earlier draft also minted our `workspace_id` (the UUID we own) into WorkOS user metadata at provisioning, surfaced as a `zaks-io:metadata` claim, so `api` could resolve the actor's workspace from the token and skip the authorization DB lookup entirely.

Dropped after measurement. The authorization lookup is negligible warm and indistinguishable from the ~1s cold-start warmup floor cold — it is not a cost worth removing. Against that marginal-to-zero gain, it would have added: the codebase's first WorkOS _write_ call (`PUT /user_management/users/{id}`), a provisioning-time hook in `api` (the DB workflow has no env/WorkOS access, so the write would live in `webAuthCallback`), and a backfill for already-provisioned users whose metadata predates the write. That is a meaningful amount of machinery — including a data migration concern — for a latency win the data says is noise. Email-in-token is the proportionate change; `workspace_id`-in-token is filed here as available-but-not-worth-it, to be reconsidered only if the authorization lookup ever shows up as a real cost (it will not until there is enough warm traffic to make the cold floor irrelevant, by which point the lookup is also cheap).

## Future: multi-member workspaces

Multi-member is **not planned**. The product has one user (the author) and one member per workspace. Multi-member happens only if a real user asks for it — it is demand-driven, not roadmapped. This ADR records the seam so that _if_ that demand appears, the path is known; it does not commit to walking it.

If it ever ships, the change is **in our world**, not WorkOS's: a memberships table and a role→scope map in `api`, where RLS and the resource already live. At that point the `Scope` enum values are likely renamed to a clearer namespaced form (e.g. `workspace:publish` / `workspace:read` / `workspace:admin`) to distinguish in-workspace capability from platform role. **That rename is deliberately deferred** — renaming the universal scope vocabulary now, for a member distinction that does not yet exist (and may never), is the same overbuild this ADR declines. The seam exists; the second adapter does not, and we will not pretend it is coming.

## Consequences

- **`packages/auth`**: `resolveWorkOsIdentity` reads `zaks-io:email` (via one constant) and, when present, builds the identity from the verified `sub` + the claim, skipping `fetchWorkOsUser`. The fetch remains the fallback for tokens without the claim.
- **`apps/api`**: no change to the `workos_access_token` resolver. The authorization DB lookup stays as-is (see "Considered and dropped").
- **`packages/contracts`**: a clarifying comment at the `Scope` enum records the role/scope/permission distinction and the multi-member seam, pointing here.
- **`docs/specs`**: the auth/identity spec describes the token-carries-identity / DB-carries-authorization split as current truth, and records that the residual authed-route latency is cold-start warmup (resolves with traffic), not the auth path.
- **WorkOS dashboard**: the dashboard client has a JWT Template emitting `zaks-io:email`. CLI and MCP clients are intentionally left without it; they fall back to the user fetch.
- **No scope rename, no `workspace_id` in token, no WorkOS write call, no WorkOS permissions wiring, no WorkOS-org coupling** is done by this ADR.

## What this does not change

- The JWKS module-scope cache (already correct; untouched).
- ADR 0079's MCP scope-source decision (scopes derive from the member, not the token). This ADR is consistent with it.
- ADR 0034 (`api` is the authorization/RLS authority). Reinforced.
- CLI and MCP authentication paths (they fall back to the existing fetch/lookup).
- The `Scope` enum values (`publish`/`read`/`admin`) — renamed only when multi-member ships.

## Latency finding (so the next person does not re-chase it)

The headline "dashboard is slow" was measured, not assumed. The ~1–2.7s on authed routes is **cold Worker isolate + cold Hyperdrive→Postgres connection warmup**, the same on preview and production, because neither has continuous traffic pre-launch (warm isolates serve the same routes in 1–171ms). The Neon-autosuspend hypothesis was investigated and **ruled out**: `suspend_timeout_seconds` is `0` (never suspend) on the preview, PR-branch, and production computes, and Hyperdrive query caching is enabled on `agent-paste-db-preview` and `agent-paste-db-production`. There is no infra knob left to turn; the warmup floor disappears with real traffic. The substantive, always-present win that _is_ code-fixable is removing the ~100ms per-request WorkOS user fetch — which is what this ADR does via the email claim.
