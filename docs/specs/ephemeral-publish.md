# Ephemeral Publish Spec

The decision and rationale are [ADR 0075](../adr/0075-agent-first-ephemeral-publish-and-write-gated-monetization.md). This spec is the shipped post-MVP shape for agent-first ephemeral publish, Claim Token promotion, write-gated tiers, and abuse containment.

## Product Promise

This spec owns the shipped ephemeral flow. The canonical use-case framing lives
in [`use-cases.md`](./use-cases.md).

An agent with no credential and no human in the loop can publish in one call and immediately hand off a working URL:

```sh
agent-paste publish ./sim --ephemeral
```

The command provisions an **Ephemeral Workspace** behind the scenes, publishes the **Artifact**, and returns both a working **unlisted Share Link** (`unlisted_url`; a no-login, script-disabled URL the agent hands back at once) and a one-time **claim link** (`claim_url`; the **Claim Token** rides the URL hash only). Auto-creating the unlisted Share Link is the one exception to "publish is content-only and private": an accountless publish has no human in the loop to run a follow-up `set-visibility` call, so the server mints it at finalize. The trial is deliberately short-lived and tightly capped. When the agent's operator wants persistence, interactivity (executable HTML/JS), or higher write volume, they log in (free) and open the claim link to reparent the **Artifacts** into their **Personal Workspace** while marking the source **Ephemeral Workspace** consumed; heavy publishers pay for the `pro` **Plan**. Reads are never gated beyond the existing **Artifact Rate Limit** - the audience is never the thing that is throttled.

Selection rule for agents: check for authenticated publish before choosing
Ephemeral Publish. Run `agent-paste whoami --json`; it exits `0` whether or not
a credential is present, so the check is the JSON body, not the exit code. If it
reports a signed-in identity, publish normally without `--ephemeral`. If it
reports `"authenticated": false` and interactive auth is possible, run
`agent-paste login` first. Use `--ephemeral` only when no login is available, or
when the user explicitly asks for accountless publish. Ephemeral is not the
`free` **Plan**; it is the unclaimed
restricted tier. Use it for non-interactive text, markdown, images, and static
HTML/CSS. In particular, interactive HTML/JavaScript work that needs script
execution requires authenticated publish, because unclaimed ephemeral content is
served under the script-disabled **Execution Policy**.

## Actors

**Ephemeral Publisher**:
An unattended agent that self-provisions an **Ephemeral Workspace** and publishes against it. The CLI holds a short-lived scoped credential for the unclaimed tenant. It grants `publish` and `read` only, never `admin`.

**Claimer**:
A **Workspace Member** (authenticated through WorkOS) who redeems a **Claim Token** to reparent the ephemeral tenant's **Artifacts** into their existing Personal **Workspace** at the claimed `free` tier (see Claim Flow). The source **Ephemeral Workspace** is marked consumed; claim never creates a standalone **Workspace**.

**Unauthenticated Recipient**:
Unchanged from [`mvp.md`](./mvp.md) - a human or agent with an explicitly minted **Access Link Signed URL**, viewing only until **Auto Deletion**.

## Surfaces

**API Worker** (`api`):
Adds two unauthenticated-entry routes through the route registrar ([ADR 0072](../adr/0072-contract-driven-route-registrar-and-guard.md)):

- `POST /v1/ephemeral/provision` - creates an **Ephemeral Workspace**, a short-lived scoped credential, and a **Claim Token**.
- `POST /v1/ephemeral/claim` - requires `workos_access_token`; reparents the tenant's **Artifacts** into the claiming member's Personal **Workspace**.

`POST /v1/ephemeral/provision` and `POST /v1/ephemeral/claim` are the mutating
entry routes for provisioning and claiming. The artifact upload and publish
flow itself reuses the existing authenticated **Upload Session** and **Publish**
routes with the provisioned credential; no separate upload or publish endpoints
are introduced.

`POST /v1/ephemeral/provision` accepts an optional `claim_code` string for
analytics correlation. The claim code public shape is `clm_` plus the same
26-character Crockford ULID body used by other public IDs. It is not identity,
auth, idempotency, billing, or ownership state. It must not change provision,
publish, claim, or entitlement behavior. Malformed claim-code strings are
ignored for telemetry rather than failing the product flow.

**Upload Worker** (`content` and `upload`):
Unchanged. `content` stays DB-free ([ADR 0028](../adr/0028-signed-url-tokens-for-content-gateway-authorization.md)); ephemeral status is carried on rows the authenticated paths already load.

**Jobs Worker** (`jobs`):
Honors the shorter ephemeral **Auto Deletion** in the existing sweep and
consumes warning metadata jobs. For `ephemeral_tier`, warning metadata can
include built-in text rules, dormant-script warnings, Llama Guard, and
Cloudflare URL Scanner. These are advisory and abuse-response signals, not
content certification or the trust boundary.

**Web** (`apps/web`):
Hosts the claim/upgrade UI. Turnstile guards these human surfaces only.

## Provision Flow

1. The client calls `POST /v1/ephemeral/provision`. The endpoint may require a lightweight provisioning challenge before it will mint credentials. That challenge is friction, not a meaningful security boundary.
   A single-shard Durable Object gate is the authoritative hard global ceiling
   for provisioning. Its `limit_per_minute` defaults to 17 and is operator-tunable
   at runtime via the `EPHEMERAL_PROVISION_CONFIG` KV namespace (valid range 1–100,
   monotonic `config_version` required when the key is set). The Durable Object is the
   authoritative runtime-config reader and rejects stale KV reads against applied DO
   state; the API route does not read KV directly. When the KV binding is absent or
   the key is unset, the compiled default applies. Invalid, stale, or unreadable KV
   config fails closed. If the gate binding, request, storage, or response is
   unavailable or invalid, the endpoint fails closed with
   `ephemeral_provision_unavailable` and `Retry-After` instead of minting credentials.
   Exhausting the gate returns `ephemeral_provision_rate_limited` and does not create
   tenant state.
2. Under a reserved system actor through `runCommand` ([ADR 0035](../adr/0035-runcommand-sequencing-and-idempotency-records.md)), `api`:
   - creates a **Workspace** flagged ephemeral, no **Workspace Member**, ephemeral cap set;
   - creates a short-lived scoped credential with `publish` + `read` **Scopes**;
   - generates a one-time **Claim Token** (signed, single-use, stored hashed);
     if a valid claim code was supplied, it is embedded inside the opaque Claim
     Token bearer so it can attribute claim conversion without query strings;
   - emits an **Audit Event**.
3. Response returns the credential secret and the **Claim Token** to the caller only. The **Claim Token** is never placed in any **Access Link Signed URL**.

## Claim Flow

1. An authenticated **Workspace Member** calls `POST /v1/ephemeral/claim` with `{ claim_token }`. The API parses any embedded claim code from the token for claim-conversion telemetry.
2. `api` verifies the token is valid, unredeemed, and not expired.
3. Under `runCommand`: **reparents** the ephemeral tenant's **Artifacts** into the claiming member's existing **Personal Workspace** (single-workspace-per-member is preserved - claim does not create a standalone tenant the member must juggle in a multi-workspace dashboard the product does not yet have), raises the surviving content to the destination workspace's `free` tier, marks the source **Ephemeral Workspace** consumed, marks the **Claim Token** redeemed, emits an **Audit Event**. The reparent is the single-core write ([ADR 0070](../adr/0070-repository-core-ports-and-adapters.md)) and re-stamps `workspace_id` so RLS continues to hold against the destination tenant.
4. A redeemed or expired token fails closed as not-found ([ADR 0036](../adr/0036-error-envelope-and-generic-404-boundary.md)). No retained **Claim Token** means the **Artifact** cannot be promoted and reaches **Auto Deletion**; it must be re-published to gain an owner.

## Claim-Code Funnel Telemetry

The marketing-to-claim funnel is tracked in Workers Analytics Engine through the
`FUNNEL_EVENTS` binding. The current event contract is:

- `prompt_copied` when the apex marketing page copies the install/publish prompt;
- `ephemeral_provision_started` when API provision receives the claim code;
- `ephemeral_workspace_created` when an Ephemeral Workspace and Claim Token are minted;
- `ephemeral_provision_rate_limited` and `ephemeral_provision_unavailable` for failed provision gate outcomes;
- `ephemeral_publish_created` when the first ephemeral publish finalizes;
- `ephemeral_link_opened` when the generated unlisted Share Link resolves;
- `link_claimed` when a Claim Token reparents Artifacts into a Personal Workspace; this is where embedded claim-code conversion attribution is recorded.

The CLI accepts `--claim-code <clm_...>`, then passes it through provision,
and publish. The API embeds it in the Claim Token returned by provision. The
unlisted Share Link is unchanged, the claim link is always `/claim#<claim_token>`,
and no generated URL contains `claim_code` in a query string. The apex marketing
page records `prompt_variant` only on
`prompt_copied`, keyed by the same claim code, so future LaunchDarkly assignment
can plug in without changing the event schema.

## Write Allowance and Tiers

The gate is the **daily new-Artifact write allowance**. A new **Artifact** counts; a new **Revision** of an existing one does not, bounded by a per-**Artifact** lifetime **Revision** ceiling (100 / **Artifact**) so a refinement loop cannot become a free-write firehose. Concrete numbers are platform-controlled values that live in the usage-policy ledger ([ADR 0056](../adr/0056-mvp-usage-policy-defaults-and-platform-caps.md)); pinned for build (operator-tunable, never platform-secret per ADR 0056):

| Tier                  | Identity                                                                                                     | Daily new Artifacts | Auto Deletion       | Indexing  | Raisable |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------- | ------------------- | --------- | -------- |
| Ephemeral (unclaimed) | scoped credential on **Ephemeral Workspace**                                                                 | 20                  | 24h                 | `noindex` | No       |
| Claimed `free`        | **Workspace Member** + scoped credentials                                                                    | 100                 | 3d default / 7d max | default   | No       |
| `pro`                 | claimed + Stripe ([ADR 0073](../adr/0073-open-core-billing-plan-tiered-usage-policy-disabled-by-default.md)) | 2000 (fair-use)     | up to 90d           | default   | Yes      |

Reads are gated only by the existing **Artifact Rate Limit** abuse ceiling ([ADR 0048](../adr/0048-transient-artifacts-by-default.md)), unchanged.

## Anti-Abuse Stack

Ordered by priority; each is invisible to honest agents or felt only at volume.

1. **Isolated Content Origin + Execution Policy** - already in place ([ADR 0030](../adr/0030-mvp-execution-policy-cdn-allowlisted-csp.md), [ADR 0001](../adr/0001-private-artifact-storage-behind-controlled-origin.md)). Architectural prerequisite.
2. **Shortest ephemeral Auto Deletion** - caps content dwell time; primary lever against phishing/malware/SEO value.
3. **Provision write dampening plus hard global gate.** Native `[[ratelimits]]` bindings remain as an outer layer for per-source dampening and obvious regional bursts ([ADR 0064](../adr/0064-native-ratelimit-bindings-for-authenticated-counters.md)). They are not the load-bearing global cost-control guarantee. The authoritative aggregate ceiling is the API Worker's single named Durable Object gate; it fails closed before any **Ephemeral Workspace**, credential, or **Claim Token** is created.
4. **`noindex`/`nofollow`** on ephemeral content.
5. **Advisory warning and URL Scanner signals** - built-in warning rules, dormant-script warnings, Llama Guard, and Cloudflare URL Scanner can support reader warnings or abuse response. Containment does not depend on them.

Not adopted: Turnstile on the agent path (browser-only, blocks the hero use case), Cloudflare Bot Management score / JA3 / JA4 (Enterprise-only), WAF Content Scanning (Enterprise + files-only), and file-bytes hash-reputation malware scanning such as VirusTotal or MalwareBazaar provider checks. Turnstile is used only on the human claim/upgrade surfaces. The lightweight provisioning challenge is intentionally not counted as a security control.

## Script Execution by Tier

Executable JavaScript requires a claimed tenant and the controlled **Artifact Viewer** path, so the platform only runs agent code behind an auditable identity ([ADR 0075](../adr/0075-agent-first-ephemeral-publish-and-write-gated-monetization.md)). The line is enforced at serve time by the **Execution Policy** and viewer-frame checks, not by inspecting HTML.

| Content                                        | Ephemeral (unclaimed)                 | Claimed (`free`+)                                   |
| ---------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| markdown, text, JSON, images                   | renders                               | renders                                             |
| static HTML + CSS (no script)                  | renders                               | renders                                             |
| HTML with `<script>` / inline handlers / `.js` | renders inert (script never executes) | executes only inside the controlled Artifact Viewer |

- **Two Execution Policies.** Ephemeral content is served under a script-disabled policy (`script-src 'none'`, no inline, no event handlers), overriding the base CDN-allowlisted policy ([ADR 0030](../adr/0030-mvp-execution-policy-cdn-allowlisted-csp.md)) the same way the SVG case overrides it today ([ADR 0042](../adr/0042-strict-extension-based-served-content-type.md)). Embedded script is allowed to be _present_ but never _runs_; it fails closed against unknown smuggling vectors.
- **`content` stays DB-free.** The tier signal rides in the verified content-gateway token payload as a script-disabled bit set by `api` at mint time. `content` selects the CSP from the token with no lookup ([ADR 0028](../adr/0028-signed-url-tokens-for-content-gateway-authorization.md)); an absent or unverifiable bit defaults to script-disabled. Direct top-level `usercontent` HTML navigations are also forced script-disabled at request time.
- **Claiming enables viewer execution.** Promotion to a claimed **Workspace** mints subsequent viewer content-gateway tokens without the script-disabled bit, and the `content` Worker only serves the interactive policy for trusted Artifact Viewer iframe navigations. Direct `usercontent` HTML remains inert raw byte delivery.

## Data-Model Deltas

Field-level shape lands in [`data-model.md`](./data-model.md) and the contracts source ([`contracts.md`](./contracts.md)) before implementation. Resolved shape:

- `workspaces`: add a `claimed_at TIMESTAMPTZ NULL` column. `claimed_at IS NULL` means the tenant is still ephemeral and selects the ephemeral cap set; a non-null value marks it consumed by a claim. No separate boolean flag - the timestamp is the state.
- `claim_tokens` is a **separate RLS-scoped table** (not folded onto the workspace row): `id` (`ap_ct_…`), `workspace_id` (FK, RLS scope), `token_hash` (HMAC, never plaintext), `expires_at`, `redeemed_at NULL`, `created_at`. A separate table keeps audit clean and leaves room to re-issue without nullable-column sprawl on `workspaces`.
- No new tenant table escapes RLS ([ADR 0044](../adr/0044-workspace-isolation-via-postgres-rls.md)); ephemeral tenants and `claim_tokens` are ordinary `workspace_id`-scoped rows.

## Acceptance Criteria

- A valid `provision` call returns a working scoped credential and a one-time **Claim Token**.
- A freshly provisioned credential can run the standard **Upload Session** → **Publish** loop with `publish` + `read` only.
- An ephemeral **Publish** auto-creates the **Artifact**'s unlisted Share Link at finalize and returns its minted no-login URL as `unlisted_url`, so the agent hands back a link that works immediately without a separate `set-visibility` step. The link reuses the **Artifact**'s one active Share Link (so an idempotent publish replay does not stack links) and remains revocable. This auto-unlist is scoped to ephemeral tenants; authenticated publishes stay private by default.
- The ephemeral daily new-**Artifact** allowance is enforced; exceeding it returns a stable rate-limit error with `Retry-After`; new **Revisions** of an existing **Artifact** are not counted (up to the lifetime ceiling).
- Ephemeral **Artifacts** carry the shortest **Auto Deletion** and `noindex`; they are swept on schedule.
- A valid **Claim Token** redeemed by an authenticated **Workspace Member** reparents the surviving **Artifacts** into the member's Personal **Workspace** at the `free` cap set, marks the source **Ephemeral Workspace** consumed, and is single-use thereafter.
- A **Claim Token** that is redeemed, expired, or absent from the public Access Link Signed URL grants no ownership.
- Reads against an ephemeral **Artifact** are gated only by the existing **Artifact Rate Limit**, not by any per-publisher read cap.
- An ephemeral **Artifact** containing script renders inert: static markup and CSS display, and no `<script>`, inline handler, or `.js` asset executes, because the content-gateway token carries the script-disabled bit and `content` selects the script-disabled **Execution Policy** with no DB lookup. After the tenant is claimed, newly minted viewer tokens may omit the bit, but script executes only inside the controlled Artifact Viewer iframe; direct `usercontent` HTML remains inert.
- Provision and claim emit **Audit Events**. A malicious Cloudflare URL Scanner
  verdict on ephemeral content can drive artifact-scoped **Platform Lockdown**;
  operator review can also drive **Platform Lockdown**.
