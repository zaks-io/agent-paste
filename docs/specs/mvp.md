# MVP Spec

agent-paste lets agents publish durable, shareable work products as **Artifacts**. A human can view them online, another agent can inspect them through **Agent View**, and the owning **Workspace** can manage access, lifecycle, and safety controls.

This document is the current MVP story. It deliberately avoids implementation mechanics; ADRs remain the source for protocol, storage, auth, and operations details.

## Product Promise

An agent should be able to run one publish command, upload a file or folder, and receive stable links that work for both humans and agents. The platform should make the content easy to inspect while treating uploaded bytes as untrusted from the first request onward.

The MVP favors a narrow, safe, shippable product:

- One human per **Workspace**.
- CLI and REST as the full-fidelity agent surfaces.
- MCP as an OAuth-only, text-only hosted-agent surface.
- Unauthenticated reading through revocable **Access Links**.
- Content served from an isolated **Content Origin**.
- Background jobs for cleanup, bundles, retention, and safety scanning.

## Actors

**Workspace Member**: the human who owns the MVP **Workspace**. Through the dashboard, this actor has full workspace authority, including **Member-Only Scopes**.

**CLI-authenticated Workspace Member**: the same human acting through `agent-paste login`. This actor carries explicit `write`, `read`, and `share` **Scopes** and does not receive dashboard-only authority.

**API Key agent**: an agent or script using an **API Key** scoped to a **Workspace**. API Keys can publish and manage artifacts according to their granted **Scopes**.

**MCP-hosted agent**: a hosted agent using the MCP server at `https://mcp.agent-paste.sh`. MCP uses OAuth only, never API Keys, and carries explicit **Scopes**.

**Unauthenticated recipient**: a human or agent with an **Access Link Signed URL**. This actor can read only what the signed URL resolves to.

**Operator**: an allowlisted platform identity that can perform platform-wide safety and takedown actions through operator-only routes.

Source: [`CONTEXT.md`](../../CONTEXT.md), [ADR 0034](../adr/0034-unified-scope-model-across-actors.md), [ADR 0046](../adr/0046-operator-identity-and-web-admin-surface.md), [ADR 0060](../adr/0060-cli-authentication-via-auth0-loopback.md), [ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md).

## Surfaces

**CLI**: the main agent-facing product for files, folders, binaries, bundles, and local developer workflows. It supports login, publish, read/manage commands, link management, lockdown, download, and `whoami`.

**REST API**: the public lower-level integration surface. It exposes the route contract used by the CLI and non-Node integrations.

**Web dashboard**: the human workspace surface for signup, first-run key copy, artifact management, access-link management, API Keys, audit log, usage policy, and workspace administration.

**Access Link viewer**: the unauthenticated app route that reads a fragment-bearing **Access Link Signed URL** and resolves it through the API.

**Content Origin**: the isolated origin that serves untrusted artifact files and renderer pages.

**MCP server**: an OAuth-only hosted-agent surface for text artifacts and lightweight management.

**Jobs**: background execution for bundle generation, cleanup, deletion/retention work, and safety scans.

Source: [ADR 0006](../adr/0006-small-workers-by-trust-and-scaling-boundary.md), [ADR 0017](../adr/0017-openapi-contract-with-ergonomic-sdk-and-cli.md), [ADR 0033](../adr/0033-tanstack-start-for-the-web-app.md), [ADR 0037](../adr/0037-internal-api-client-package-powers-cli.md), [ADR 0047](../adr/0047-access-link-signed-url-with-fragment-encoded-payload.md), [ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md).

## Core Journeys

### 1. Sign Up and Get a Workspace

A new human signs in through Auth0. First sign-in creates a **Personal Workspace**, a **Workspace Member**, a default **Usage Policy**, and a default **API Key** with `write`, `read`, and `share` **Scopes**. The default key secret is shown once in the dashboard and is not retrievable later.

The user can also run `agent-paste login` for CLI-based OAuth. The CLI session is refreshable, local to the machine, and less powerful than the dashboard because it cannot carry **Member-Only Scopes**.

Source: [ADR 0055](../adr/0055-signup-auto-provisions-personal-workspace-and-default-key.md), [ADR 0059](../adr/0059-web-app-session-and-auth-forwarding-to-api.md), [ADR 0060](../adr/0060-cli-authentication-via-auth0-loopback.md).

### 2. Publish an Artifact

An agent publishes a single file or folder. The result is a complete immutable **Revision** on an **Artifact**. The platform infers **Entrypoint** and **Render Mode** when obvious, and publish fails when they cannot be inferred or an override cannot be applied.

Every successful **Publish** creates a **Revision Link** for the exact **Revision**. A **Share Link** is created only when requested. The **Publish Result** includes identifiers, human-view links, agent-view links, **Bundle Availability**, and any synchronous **Safety Warnings**.

Source: [`CONTEXT.md`](../../CONTEXT.md), [ADR 0017](../adr/0017-openapi-contract-with-ergonomic-sdk-and-cli.md), [ADR 0027](../adr/0027-upload-write-path.md), [ADR 0037](../adr/0037-internal-api-client-package-powers-cli.md), [ADR 0054](../adr/0054-agent-view-envelope-shape.md).

### 3. Share and Resolve Access

A **Private Link** gives authenticated workspace access to the latest **Published Revision**. A **Share Link** gives unauthenticated access to the latest **Published Revision**. A **Revision Link** gives unauthenticated access to one specific **Revision**.

Access Links are materialized as **Access Link Signed URLs** with fragment-encoded signed payloads. A recipient's browser or agent preserves the fragment and resolves it through `POST /v1/access-links/resolve`. The response is **Agent View** plus short-lived content URLs.

Source: [ADR 0047](../adr/0047-access-link-signed-url-with-fragment-encoded-payload.md), [ADR 0052](../adr/0052-agent-view-discovery-from-access-link-signed-urls.md).

### 4. View Content Safely

Uploaded files are always **Untrusted Content**. They are served only from the isolated **Content Origin**, never through direct R2 URLs. The platform derives served content type from file extension, not from agent-supplied MIME hints.

HTML can run JavaScript inside the MVP **Execution Policy**, but network egress is constrained. Markdown, text, image, audio, video, and directory views are supported by the platform's render modes and renderer pages.

Source: [ADR 0001](../adr/0001-private-artifact-storage-behind-controlled-origin.md), [ADR 0028](../adr/0028-signed-url-tokens-for-content-gateway-authorization.md), [ADR 0029](../adr/0029-in-origin-renderer-pages-for-non-html-render-modes.md), [ADR 0030](../adr/0030-mvp-execution-policy-cdn-allowlisted-csp.md), [ADR 0042](../adr/0042-strict-extension-based-served-content-type.md).

### 5. Inspect Through Agent View

**Agent View** is the machine-readable read surface. It returns a **Manifest**, **Display Metadata**, file listing, `content_prefix`, **Safety Warnings**, and **Bundle Availability** for the resolved **Revision**.

Authenticated **Agent View** can include the **Creator** reference. Agent View resolved through an unauthenticated **Access Link** omits that reference.

Source: [ADR 0052](../adr/0052-agent-view-discovery-from-access-link-signed-urls.md), [ADR 0053](../adr/0053-manifest-shape-and-creator-visibility.md), [ADR 0054](../adr/0054-agent-view-envelope-shape.md).

### 6. Update and Manage Artifacts

A new publish to an existing **Artifact** creates a new complete **Revision**. **Private Links** and **Share Links** move to the latest **Published Revision**; existing **Revision Links** stay pinned to their original **Revision** while that **Revision** remains retained.

Authorized actors can update **Display Metadata**, create or revoke **Access Links**, enter or lift **Access Link Lockdown**, delete an **Artifact**, and download a **Bundle** when available.

Source: [`CONTEXT.md`](../../CONTEXT.md), [ADR 0037](../adr/0037-internal-api-client-package-powers-cli.md), [ADR 0047](../adr/0047-access-link-signed-url-with-fragment-encoded-payload.md), [ADR 0048](../adr/0048-transient-artifacts-by-default.md), [ADR 0050](../adr/0050-bundle-availability-and-asymmetric-dlq-consumption.md).

### 7. Publish Through MCP

Hosted agents can connect to the MCP server with OAuth. MCP tools support text-only publish/update operations for `text`, `markdown`, and `html` render modes. Binary, image, audio, video, directory, bundle download, and multi-file workflows remain CLI/REST territory.

MCP publish still follows the domain rule that **Publish** requires `write`, `read`, and `share`, because it creates the required **Revision Link**. The optional `share` argument controls only optional **Share Link** creation.

Source: [ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md).

### 8. Operate Safely

The platform records **Audit Events** for security-relevant and lifecycle changes. Public errors use stable codes. Invalid or unauthorized cross-tenant reads fail with generic not-found semantics.

Operators can apply **Platform Lockdown** to an **Artifact** or **Workspace**. A workspace-scoped lockdown also suspends every **API Key** in that workspace. Operator actions create **Audit Events** visible to affected workspace members.

Source: [ADR 0004](../adr/0004-audit-state-changes-through-wrapper.md), [ADR 0036](../adr/0036-error-envelope-and-generic-404-boundary.md), [ADR 0040](../adr/0040-platform-lockdown-for-operator-initiated-takedown.md), [ADR 0046](../adr/0046-operator-identity-and-web-admin-surface.md).

## MVP Acceptance Shape

The MVP is ready when the product can reliably do these things:

- A new user can sign in, receive a personal workspace, and copy the one-time default API Key.
- A user can authenticate the CLI through `agent-paste login` and publish a file or folder.
- A CI or headless agent can publish with `AGENT_PASTE_API_KEY`.
- A publish returns a **Private Link**, required **Revision Link**, optional **Share Link**, **Agent View** link, **Bundle Availability**, and **Safety Warnings**.
- A recipient can open an **Access Link Signed URL** and view the artifact without tenant auth.
- Another agent can resolve that same URL into **Agent View** without dropping the URL fragment.
- The content origin serves supported render modes with the fixed MVP **Execution Policy** and extension-derived content types.
- A user or scoped agent can update metadata, create/revoke links, enter/lift **Access Link Lockdown**, delete artifacts, and download ready bundles.
- MCP hosts can connect through OAuth and perform text-only publish/read/manage flows.
- Background jobs handle bundle generation, cleanup, retention, deletion purge, and stub safety scans.
- Audit, error, rate-limit, and redaction behavior match the ADR baseline.

## MVP Boundaries

Out of MVP:

- Multi-member workspaces, invites, and account linking.
- Billing tiers and cost controls.
- Per-artifact **Usage Policy**.
- Per-workspace overrides beyond Auto Deletion.
- Custom **Execution Policy** per artifact or workspace.
- Real safety scanner integration beyond the stub lifecycle.
- MCP binary or multi-file publish.
- API Keys on the MCP surface.
- Stateful MCP sessions, prompts, sampling, or subscriptions.
- Public TypeScript SDK publication.
- Standalone CLI binary distribution.

Source: [ADR 0017](../adr/0017-openapi-contract-with-ergonomic-sdk-and-cli.md), [ADR 0041](../adr/0041-upload-size-caps-under-usage-policy.md), [ADR 0051](../adr/0051-safety-scanner-lifecycle.md), [ADR 0055](../adr/0055-signup-auto-provisions-personal-workspace-and-default-key.md), [ADR 0056](../adr/0056-mvp-usage-policy-defaults-and-platform-caps.md), [ADR 0060](../adr/0060-cli-authentication-via-auth0-loopback.md), [ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md).

## Canonical Decisions to Keep in Mind

- **Publish** always creates a **Revision Link**.
- **Share Links** follow the latest **Published Revision**; **Revision Links** pin one **Revision**.
- Access Link credentials live in URL fragments, not path or query strings.
- The unauthenticated recipient path is `POST /v1/access-links/resolve`.
- `content_prefix`, not per-file URL maps, is the **Agent View** content access shape.
- **Display Metadata** is plain text and does not create a new **Revision**.
- Uploaded bytes are never trusted, even when uploaded by trusted actors.
- Dashboard-authenticated members have implicit full workspace authority; CLI and MCP tokens do not.
- **Member-Only Scopes** never appear on API Keys, CLI tokens, or MCP tokens.
- **Deletion** is not reversible as an access state.
- **Retention** removes old non-published **Revisions**; **Auto Deletion** deletes whole published **Artifacts**.
