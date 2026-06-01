# Ephemeral Publish Spec

The decision and rationale are [ADR 0075](../adr/0075-agent-first-ephemeral-publish-and-write-gated-monetization.md). This spec is the buildable shape. It is a post-MVP phase and is not a CLI-first MVP build gate ([ADR 0066](../adr/0066-cli-first-mvp-contract-narrowing.md)); it lands with or after the web/OAuth/billing surfaces of Phase 3 ([`phases.md`](./phases.md)).

## Product Promise

An agent with no credential and no human in the loop can publish in one call and immediately hand off a working URL:

```sh
agent-paste publish ./sim --ephemeral
```

The command provisions an **Ephemeral Workspace** behind the scenes, publishes the **Artifact**, prints the share URL and a one-time **Claim Token**, and the link works at once. The trial is deliberately short-lived and tightly capped. When the agent's operator wants persistence or higher write volume, they log in (free) and redeem the **Claim Token** to promote the tenant; heavy publishers pay for the `pro` **Plan**. Reads are never gated beyond the existing **Artifact Rate Limit** — the audience is never the thing that is throttled.

## Actors

**Ephemeral Publisher**:
An unattended agent that self-provisions an **Ephemeral Workspace** and publishes against it. Holds an ordinary **API Key** with `write` and `read` **Scopes** only, scoped to an unclaimed tenant. Never holds `share` implicitly or `admin`.

**Claimer**:
A **Workspace Member** (authenticated through WorkOS) who redeems a **Claim Token** to promote an **Ephemeral Workspace** into a claimed `free` **Workspace** they own as the first `admin`.

**Unauthenticated Recipient**:
Unchanged from [`mvp.md`](./mvp.md) — a human or agent with a share URL, viewing only until **Auto Deletion**.

## Surfaces

**API Worker** (`api`):
Adds two unauthenticated-entry routes through the route registrar ([ADR 0072](../adr/0072-contract-driven-route-registrar-and-guard.md)):

- `POST /v1/ephemeral/provision` — proof-of-work gated; mints **Ephemeral Workspace** + **API Key** + **Claim Token**.
- `POST /v1/ephemeral/claim` — requires `workos_access_token`; promotes the tenant.

The ephemeral **Publish** itself reuses the existing authenticated **Upload Session** and **Publish** routes with the minted **API Key**. No new write surface.

**Upload Worker** (`content` and `upload`):
Unchanged. `content` stays DB-free ([ADR 0028](../adr/0028-signed-url-tokens-for-content-gateway-authorization.md)); ephemeral status is carried on rows the authenticated paths already load.

**Jobs Worker** (`jobs`):
Routes ephemeral content to stronger **Safety Scanner** rules under a new `scanner_id` and honors the shorter ephemeral **Auto Deletion** in the existing sweep.

**Web** (`apps/web`):
Hosts the claim/upgrade UI. Turnstile guards these human surfaces only.

## Provision Flow

1. The client requests a proof-of-work challenge (or receives one in a `401`-style envelope on a bare `provision` call) — a hashcash-style nonce + difficulty issued and signed by `api`.
2. The client solves it (a few hundred ms of CPU) and calls `POST /v1/ephemeral/provision` with the solution.
3. `api` verifies the solution, then under a reserved system actor through `runCommand` ([ADR 0035](../adr/0035-runcommand-sequencing-and-idempotency-records.md)):
   - creates a **Workspace** flagged ephemeral, no **Workspace Member**, ephemeral cap set;
   - mints an **API Key** (`ap_pk_{env}_{publicId}_{secret}`, [ADR 0043](../adr/0043-bearer-credential-format-and-storage.md)) with `write` + `read` **Scopes**, short **Expiration**;
   - generates a one-time **Claim Token** (signed, single-use, stored hashed);
   - emits an **Audit Event**.
4. Response returns the **API Key** secret and the **Claim Token** to the caller only. The **Claim Token** is never placed in any **Access Link Signed URL**.

## Claim Flow

1. An authenticated **Workspace Member** calls `POST /v1/ephemeral/claim` with `{ claim_token }`.
2. `api` verifies the token is valid, unredeemed, and not expired.
3. Under `runCommand`: **reparents** the ephemeral tenant's **Artifacts** into the claiming member's existing **Personal Workspace** (single-workspace-per-member is preserved — claim does not create a standalone tenant the member must juggle in a multi-workspace dashboard the product does not yet have), raises the surviving content to the destination workspace's `free` tier, marks the source **Ephemeral Workspace** consumed, marks the **Claim Token** redeemed, emits an **Audit Event**. The reparent is the single-core write ([ADR 0070](../adr/0070-repository-core-ports-and-adapters.md)) and re-stamps `workspace_id` so RLS continues to hold against the destination tenant.
4. A redeemed or expired token fails closed as not-found ([ADR 0036](../adr/0036-error-envelope-and-generic-404-boundary.md)). No retained **Claim Token** means the **Artifact** cannot be promoted and reaches **Auto Deletion**; it must be re-published to gain an owner.

## Write Allowance and Tiers

The gate is the **daily new-Artifact write allowance**. A new **Artifact** counts; a new **Revision** of an existing one does not, bounded by a per-**Artifact** lifetime **Revision** ceiling (100 / **Artifact**) so a refinement loop cannot become a free-write firehose. Concrete numbers are platform-controlled values that live in the usage-policy ledger ([ADR 0056](../adr/0056-mvp-usage-policy-defaults-and-platform-caps.md)); pinned for build (operator-tunable, never platform-secret per ADR 0056):

| Tier                  | Identity                                                                                                     | Daily new Artifacts | Auto Deletion          | Indexing  | Raisable |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------- | ---------------------- | --------- | -------- |
| Ephemeral (unclaimed) | **API Key** on **Ephemeral Workspace**                                                                       | 20                  | 24h                    | `noindex` | No       |
| Claimed `free`        | **Workspace Member** + **API Key**s                                                                          | 100                 | platform default (30d) | default   | No       |
| `pro`                 | claimed + Stripe ([ADR 0073](../adr/0073-open-core-billing-plan-tiered-usage-policy-disabled-by-default.md)) | 2000 (fair-use)     | up to 90d              | default   | Yes      |

Reads are gated only by the existing **Artifact Rate Limit** abuse ceiling ([ADR 0048](../adr/0048-transient-artifacts-by-default.md)), unchanged.

## Anti-Abuse Stack

Ordered by priority; each is invisible to honest agents or felt only at volume.

1. **Isolated Content Origin + Execution Policy** — already in place ([ADR 0030](../adr/0030-mvp-execution-policy-cdn-allowlisted-csp.md), [ADR 0001](../adr/0001-private-artifact-storage-behind-controlled-origin.md)). Architectural prerequisite.
2. **Shortest ephemeral Auto Deletion** — caps content dwell time; primary lever against phishing/malware/SEO value.
3. **Native `[[ratelimits]]` write dampening** per source ([ADR 0064](../adr/0064-native-ratelimit-bindings-for-authenticated-counters.md)), with a Durable Object counter for any cap needing a strongly consistent global ceiling. A global circuit breaker on aggregate ephemeral writes is the backstop when per-source is evaded.
4. **Proof-of-work on provision** — headless-solvable, scales pain with volume. Hand-rolled; Cloudflare exposes no PoW primitive.
5. **Safety Scanner ephemeral rules** ([ADR 0051](../adr/0051-safety-scanner-lifecycle.md)) under a new `scanner_id`: Workers AI Llama Guard 3 on submitted text at scan time, async Cloudflare URL Scanner verdict on the published URL. Advisory; a malicious verdict drives **Platform Lockdown** ([ADR 0040](../adr/0040-platform-lockdown-for-operator-initiated-takedown.md)).
6. **`noindex`/`nofollow`** on ephemeral content.

Not adopted: Turnstile on the agent path (browser-only, blocks the hero use case), Cloudflare Bot Management score / JA3 / JA4 (Enterprise-only), WAF Content Scanning (Enterprise + files-only). Turnstile is used only on the human claim/upgrade surfaces.

## Script Execution by Tier

Executable JavaScript requires a claimed tenant, so the platform only runs agent code behind an auditable identity ([ADR 0075](../adr/0075-agent-first-ephemeral-publish-and-write-gated-monetization.md)). The line is enforced at serve time by the **Execution Policy**, not by inspecting HTML.

| Content                                        | Ephemeral (unclaimed)                 | Claimed (`free`+) |
| ---------------------------------------------- | ------------------------------------- | ----------------- |
| markdown, text, JSON, images                   | renders                               | renders           |
| static HTML + CSS (no script)                  | renders                               | renders           |
| HTML with `<script>` / inline handlers / `.js` | renders inert (script never executes) | executes          |

- **Two Execution Policies.** Ephemeral content is served under a script-disabled policy (`script-src 'none'`, no inline, no event handlers), overriding the base CDN-allowlisted policy ([ADR 0030](../adr/0030-mvp-execution-policy-cdn-allowlisted-csp.md)) the same way the SVG case overrides it today ([ADR 0042](../adr/0042-strict-extension-based-served-content-type.md)). Embedded script is allowed to be _present_ but never _runs_; it fails closed against unknown smuggling vectors.
- **`content` stays DB-free.** The tier signal rides in the verified content-gateway token payload as a script-disabled bit set by `api` at mint time. `content` selects the CSP from the token with no lookup ([ADR 0028](../adr/0028-signed-url-tokens-for-content-gateway-authorization.md)); an absent or unverifiable bit defaults to script-disabled.
- **Advisory warning, not a gate.** A publish-time detector may raise a **Safety Warning** that script is present and dormant until the tenant is claimed ([ADR 0051](../adr/0051-safety-scanner-lifecycle.md)), as a conversion nudge. It is never the security control.
- **Claiming upgrades the policy.** Promotion to a claimed **Workspace** mints subsequent content-gateway tokens without the script-disabled bit, so script executes.

## Data-Model Deltas

Field-level shape lands in [`data-model.md`](./data-model.md) and the contracts source ([`contracts.md`](./contracts.md)) before implementation. Resolved shape:

- `workspaces`: add a `claimed_at TIMESTAMPTZ NULL` column. `claimed_at IS NULL` means the tenant is still ephemeral and selects the ephemeral cap set; a non-null value marks it consumed by a claim. No separate boolean flag — the timestamp is the state.
- `claim_tokens` is a **separate RLS-scoped table** (not folded onto the workspace row): `id` (`ap_ct_…`), `workspace_id` (FK, RLS scope), `token_hash` (HMAC, never plaintext), `expires_at`, `redeemed_at NULL`, `created_at`. A separate table keeps audit clean and leaves room to re-issue without nullable-column sprawl on `workspaces`.
- No new tenant table escapes RLS ([ADR 0044](../adr/0044-workspace-isolation-via-postgres-rls.md)); ephemeral tenants and `claim_tokens` are ordinary `workspace_id`-scoped rows.

## Acceptance Criteria

- An unauthenticated `provision` call without a valid proof-of-work solution is rejected; with a valid solution it returns a working **API Key** and a one-time **Claim Token**.
- A freshly provisioned **API Key** can run the standard **Upload Session** → **Publish** loop and the share URL resolves.
- The ephemeral daily new-**Artifact** allowance is enforced; exceeding it returns a stable rate-limit error with `Retry-After`; new **Revisions** of an existing **Artifact** are not counted (up to the lifetime ceiling).
- Ephemeral **Artifacts** carry the shortest **Auto Deletion** and `noindex`; they are swept on schedule.
- A valid **Claim Token** redeemed by an authenticated **Workspace Member** promotes the tenant to claimed `free`, attaches the member as `admin`, raises the cap set, and is single-use thereafter.
- A **Claim Token** that is redeemed, expired, or absent from the public share URL grants no ownership.
- Reads against an ephemeral **Artifact** are gated only by the existing **Artifact Rate Limit**, not by any per-publisher read cap.
- An ephemeral **Artifact** containing script renders inert: static markup and CSS display, and no `<script>`, inline handler, or `.js` asset executes, because the content-gateway token carries the script-disabled bit and `content` selects the script-disabled **Execution Policy** with no DB lookup. After the tenant is claimed, newly minted tokens omit the bit and script executes.
- Provision and claim emit **Audit Events**; a malicious **Safety Scanner** verdict drives **Platform Lockdown**.
