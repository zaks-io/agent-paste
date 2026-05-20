# Feature Index

This is the quick-read inventory of MVP features. It names what each feature does, who uses it, and where the detailed decision record lives.

## Identity and Workspace

| Feature | MVP behavior | Primary users | Source |
|---|---|---|---|
| Auth0 sign-in | Human authentication for the dashboard. Unverified emails are rejected. | Workspace Member | [ADR 0002](../adr/0002-auth0-for-workspace-authentication.md), [ADR 0055](../adr/0055-signup-auto-provisions-personal-workspace-and-default-key.md) |
| Personal Workspace | First sign-in auto-provisions one **Personal Workspace** and one **Workspace Member**. | Workspace Member | [ADR 0055](../adr/0055-signup-auto-provisions-personal-workspace-and-default-key.md) |
| Default API Key | First sign-in creates a default key with `write`, `read`, and `share`; the secret is shown once. | Workspace Member, API Key agent | [ADR 0055](../adr/0055-signup-auto-provisions-personal-workspace-and-default-key.md), [ADR 0043](../adr/0043-bearer-credential-format-and-storage.md) |
| Scope model | Dashboard members have full workspace authority. API Keys, CLI sessions, and MCP tokens carry explicit scope subsets. | All authenticated actors | [ADR 0034](../adr/0034-unified-scope-model-across-actors.md), [ADR 0060](../adr/0060-cli-authentication-via-auth0-loopback.md), [ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) |
| Member-only authority | API Key lifecycle, audit reads, and workspace administration require **Member-Only Scopes**. | Workspace Member | [ADR 0034](../adr/0034-unified-scope-model-across-actors.md) |

## Artifact Publishing

| Feature | MVP behavior | Primary users | Source |
|---|---|---|---|
| Artifact | Durable folder-like package containing one or more files or rendered assets. | All readers and publishers | [`CONTEXT.md`](../../CONTEXT.md) |
| Revision | Complete immutable file tree created by publish/update. | API Key agent, CLI user, MCP agent | [`CONTEXT.md`](../../CONTEXT.md) |
| Upload Session | Temporary workflow for collecting files before finalization. CLI hides it; REST exposes it for advanced clients. | CLI, REST integrations | [ADR 0027](../adr/0027-upload-write-path.md), [ADR 0017](../adr/0017-openapi-contract-with-ergonomic-sdk-and-cli.md) |
| Draft Revision | Finalized but unpublished revision state visible only to management actors with write authority. | API Key agent, Workspace Member | [`CONTEXT.md`](../../CONTEXT.md), [ADR 0027](../adr/0027-upload-write-path.md) |
| Publish | Makes a complete **Revision** visible as the **Published Revision**. Always creates a required **Revision Link**. | API Key agent, CLI user, MCP agent | [`CONTEXT.md`](../../CONTEXT.md), [ADR 0037](../adr/0037-internal-api-client-package-powers-cli.md) |
| Entrypoint | File that opens first. Inferred when obvious and overridable through CLI/REST. Directory entrypoints are reserved with directory Render Mode. | Publishers | [`CONTEXT.md`](../../CONTEXT.md), [apps/cli README](../../apps/cli/README.md) |
| Render Mode | MVP file modes are `html`, `markdown`, `text`, `image`, `audio`, and `video`. `directory` is reserved pending the listing contract. | Publishers, viewers | [`CONTEXT.md`](../../CONTEXT.md), [ADR 0029](../adr/0029-in-origin-renderer-pages-for-non-html-render-modes.md) |
| Display Metadata | Required title and optional description; plain text; mutable without a new **Revision**. | Publishers, Workspace Member | [`CONTEXT.md`](../../CONTEXT.md), [ADR 0053](../adr/0053-manifest-shape-and-creator-visibility.md) |
| Idempotent mutations | Agent-facing mutations use idempotency keys so retries do not duplicate work. | CLI, REST, MCP | [ADR 0022](../adr/0022-idempotent-agent-facing-mutations.md), [ADR 0035](../adr/0035-runcommand-sequencing-and-idempotency-records.md) |

## Links and Access

| Feature | MVP behavior | Primary users | Source |
|---|---|---|---|
| Private Link | Authenticated read link for the latest **Published Revision**. Not an **Access Link**. | Workspace Member, API Key with read | [`CONTEXT.md`](../../CONTEXT.md) |
| Access Link | Revocable unauthenticated read grant materialized as an **Access Link Signed URL**. | Recipients, sharing actors | [ADR 0047](../adr/0047-access-link-signed-url-with-fragment-encoded-payload.md) |
| Share Link | **Access Link** that follows the latest **Published Revision**. | Publishers, recipients | [`CONTEXT.md`](../../CONTEXT.md), [ADR 0047](../adr/0047-access-link-signed-url-with-fragment-encoded-payload.md) |
| Revision Link | **Access Link** pinned to exactly one **Revision**. Created by every **Publish**. | Agent-to-agent handoff, recipients | [`CONTEXT.md`](../../CONTEXT.md), [ADR 0052](../adr/0052-agent-view-discovery-from-access-link-signed-urls.md) |
| Access Link Signed URL | URL shaped with public id in path and signed payload in fragment. The fragment is the credential. | Sharing actors, recipients | [ADR 0047](../adr/0047-access-link-signed-url-with-fragment-encoded-payload.md) |
| Access Link resolve | Unauthenticated endpoint that exchanges `{ public_id, blob }` for **Agent View** and content access. | Recipients, agents | [ADR 0052](../adr/0052-agent-view-discovery-from-access-link-signed-urls.md) |
| Access Link Lockdown | Per-Artifact control that disables all **Access Links** without affecting the **Private Link**. | Workspace Member, scoped agents | [`CONTEXT.md`](../../CONTEXT.md), [ADR 0037](../adr/0037-internal-api-client-package-powers-cli.md) |

## Reading and Rendering

| Feature | MVP behavior | Primary users | Source |
|---|---|---|---|
| Agent View | Machine-readable surface with **Manifest**, file listing, `content_prefix`, metadata, warnings, and bundle state. | Agents, dashboard | [ADR 0052](../adr/0052-agent-view-discovery-from-access-link-signed-urls.md), [ADR 0054](../adr/0054-agent-view-envelope-shape.md) |
| Manifest | Platform-controlled identity for a resolved **Revision**. Workspace id is never exposed. | Agents, dashboard | [ADR 0053](../adr/0053-manifest-shape-and-creator-visibility.md) |
| Content Origin | Isolated origin for **Untrusted Content**. Direct R2 URLs are never exposed. | Viewers | [ADR 0001](../adr/0001-private-artifact-storage-behind-controlled-origin.md), [ADR 0014](../adr/0014-single-domain-with-hardened-content-subdomain.md) |
| Content gateway URLs | Short-lived URLs minted after authenticated/private or unauthenticated/access-link resolution. | Viewers, agents | [ADR 0028](../adr/0028-signed-url-tokens-for-content-gateway-authorization.md) |
| Execution Policy | Fixed MVP browser restrictions for all untrusted content, with SVG tightened further. | Viewers | [ADR 0030](../adr/0030-mvp-execution-policy-cdn-allowlisted-csp.md) |
| Served Content Type | Derived from normalized file extension allowlist, not agent MIME hints. | Viewers, agents | [ADR 0042](../adr/0042-strict-extension-based-served-content-type.md) |
| Renderer pages | In-origin renderer pages for Markdown, text, and future directory mode. | Viewers | [ADR 0029](../adr/0029-in-origin-renderer-pages-for-non-html-render-modes.md) |

## CLI

| Feature | MVP behavior | Primary users | Source |
|---|---|---|---|
| `agent-paste login` | Auth0 loopback login for interactive CLI use. | CLI user | [ADR 0060](../adr/0060-cli-authentication-via-auth0-loopback.md), [apps/cli README](../../apps/cli/README.md) |
| API key environment auth | `AGENT_PASTE_API_KEY` path for CI, headless agents, and server-to-server scripts. | API Key agent | [ADR 0043](../adr/0043-bearer-credential-format-and-storage.md), [ADR 0060](../adr/0060-cli-authentication-via-auth0-loopback.md) |
| `publish` | Full-fidelity file/folder publish command with entrypoint/render-mode controls. | CLI user, coding agents | [ADR 0017](../adr/0017-openapi-contract-with-ergonomic-sdk-and-cli.md), [ADR 0037](../adr/0037-internal-api-client-package-powers-cli.md) |
| Management verbs | `list`, `get`, `delete`, `meta set`, link CRUD, lockdown, `download`, and `whoami`. | CLI user, coding agents | [ADR 0037](../adr/0037-internal-api-client-package-powers-cli.md), [apps/cli README](../../apps/cli/README.md) |
| Download | Polls bundle availability and downloads ready bundles. | CLI user, agents | [ADR 0037](../adr/0037-internal-api-client-package-powers-cli.md), [ADR 0050](../adr/0050-bundle-availability-and-asymmetric-dlq-consumption.md) |

## MCP

| Feature | MVP behavior | Primary users | Source |
|---|---|---|---|
| OAuth-only MCP | Hosted agent auth uses OAuth 2.1 and Auth0 DCR. API Keys are not accepted. | MCP-hosted agents | [ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) |
| Text-only publish | MCP can publish/update `text`, `markdown`, and `html` single-file artifacts. | MCP-hosted agents | [ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) |
| MCP read/manage tools | Tools cover publish, add revision, list/read artifacts, list revisions, delete, metadata, link creation/revocation/listing, and `whoami`. | MCP-hosted agents | [ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) |
| Explicit scopes | MCP tokens carry explicit `write`, `read`, and `share` grants. No implicit dashboard grant. | MCP-hosted agents | [ADR 0034](../adr/0034-unified-scope-model-across-actors.md), [ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) |

## Dashboard and Human UI

| Feature | MVP behavior | Primary users | Source |
|---|---|---|---|
| Dashboard shell | Workspace dashboard on `app.agent-paste.sh`. | Workspace Member | [ADR 0033](../adr/0033-tanstack-start-for-the-web-app.md), [style guide](./style-guide.md) |
| First-run key card | Shows default API Key plaintext once after signup. | Workspace Member | [ADR 0055](../adr/0055-signup-auto-provisions-personal-workspace-and-default-key.md) |
| Artifact views | List and detail surfaces for artifacts, revisions, metadata, links, bundle state, and warnings. | Workspace Member | [style guide](./style-guide.md), [`CONTEXT.md`](../../CONTEXT.md) |
| API Key management | Create, name, scope, expire, and revoke API Keys. | Workspace Member | [ADR 0034](../adr/0034-unified-scope-model-across-actors.md), [ADR 0043](../adr/0043-bearer-credential-format-and-storage.md) |
| Audit log | Human-readable security and lifecycle event history. | Workspace Member | [ADR 0004](../adr/0004-audit-state-changes-through-wrapper.md) |
| Usage policy view | Shows workspace limits, caps, retention, auto deletion, and bundle availability policy. | Workspace Member | [ADR 0056](../adr/0056-mvp-usage-policy-defaults-and-platform-caps.md) |

## Lifecycle and Policy

| Feature | MVP behavior | Source |
|---|---|---|
| Usage Policy | Workspace-level policy controls caps, retention, auto deletion, access-link creation, rate limits, and bundle availability. | [`CONTEXT.md`](../../CONTEXT.md), [ADR 0056](../adr/0056-mvp-usage-policy-defaults-and-platform-caps.md) |
| Upload caps | 25 MB per file, 500 files per **Revision**, 100 MB per **Revision**. | [ADR 0056](../adr/0056-mvp-usage-policy-defaults-and-platform-caps.md) |
| Bundle cap | 100 MB per **Bundle**; exceeding cap fails bundle generation without failing publish. | [ADR 0056](../adr/0056-mvp-usage-policy-defaults-and-platform-caps.md), [ADR 0050](../adr/0050-bundle-availability-and-asymmetric-dlq-consumption.md) |
| Rate limits | 60 req/min actor cap, 300 req/min workspace burst cap, 60 req/min unauthenticated artifact read cap. | [ADR 0039](../adr/0039-authenticated-rate-limits-under-usage-policy.md), [ADR 0056](../adr/0056-mvp-usage-policy-defaults-and-platform-caps.md) |
| Upload Session TTL | 24 hours. | [ADR 0056](../adr/0056-mvp-usage-policy-defaults-and-platform-caps.md) |
| Auto Deletion | Default 30 days since last **Publish**, workspace-lowerable, platform-capped at 90 days. | [ADR 0048](../adr/0048-transient-artifacts-by-default.md), [ADR 0056](../adr/0056-mvp-usage-policy-defaults-and-platform-caps.md) |
| Pinned Artifacts | Workspace members can pin artifacts to exempt them from **Auto Deletion**, up to 50 pinned artifacts. | [`CONTEXT.md`](../../CONTEXT.md), [ADR 0056](../adr/0056-mvp-usage-policy-defaults-and-platform-caps.md) |
| Retention | Removes older non-published **Revisions** without removing the current **Published Revision**. | [`CONTEXT.md`](../../CONTEXT.md) |
| Deletion | Makes an entire **Artifact** inaccessible immediately; byte purge can happen asynchronously. | [`CONTEXT.md`](../../CONTEXT.md), [ADR 0049](../adr/0049-jobs-handler-patterns.md) |
| Audit Retention | 180 days. | [ADR 0056](../adr/0056-mvp-usage-policy-defaults-and-platform-caps.md) |

## Safety, Audit, and Operations

| Feature | MVP behavior | Source |
|---|---|---|
| Untrusted content rule | All uploaded files and agent-provided values are untrusted until escaped for the output context. | [ADR 0024](../adr/0024-treat-agent-provided-data-as-untrusted.md) |
| Safety Warnings | Non-blocking warnings can attach to artifacts or revisions. MVP async scanner is a stub. | [`CONTEXT.md`](../../CONTEXT.md), [ADR 0051](../adr/0051-safety-scanner-lifecycle.md) |
| Audit Events | Security-relevant and lifecycle changes create redacted audit records. | [ADR 0004](../adr/0004-audit-state-changes-through-wrapper.md) |
| Generic not-found boundary | Cross-tenant, invalid, revoked, expired, retained, or deleted reads fail without leaking reason. | [ADR 0036](../adr/0036-error-envelope-and-generic-404-boundary.md) |
| Operator Platform Lockdown | Operator can block one artifact or an entire workspace; workspace lockdown suspends API Keys. | [ADR 0040](../adr/0040-platform-lockdown-for-operator-initiated-takedown.md), [ADR 0046](../adr/0046-operator-identity-and-web-admin-surface.md) |
| KV denylist | Mid-token invalidation for revoked/locked/deleted access within content-token TTL windows. | [ADR 0057](../adr/0057-kv-denylist-namespace-keys-and-write-order.md) |
| Bundles | Generated asynchronously and exposed through **Bundle Availability**. | [ADR 0050](../adr/0050-bundle-availability-and-asymmetric-dlq-consumption.md) |
| Background jobs | Jobs handle cleanup, retention, deletion sequencing, bundle generation, and safety scans. | [ADR 0019](../adr/0019-cloudflare-queues-for-background-jobs.md), [ADR 0032](../adr/0032-jobs-worker-trigger-model-and-queue-topology.md), [ADR 0049](../adr/0049-jobs-handler-patterns.md) |

## Out of MVP

- Multi-member workspaces and invites.
- Account linking across Auth0 connections.
- Billing and paid tiers.
- Per-artifact **Usage Policy**.
- Per-workspace overrides beyond Auto Deletion.
- Custom **Execution Policy**.
- Blocking safety scans or real scanner integration.
- MCP binary, image, audio, video, directory, bundle download, or multi-file publish.
- Directory listing rendering until its listing-source contract is decided.
- API Key authentication for MCP.
- Stateful MCP sessions, sampling, prompts, or subscriptions.
- Public TypeScript SDK publication.
- Standalone CLI binary distribution.
