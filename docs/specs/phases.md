# Delivery Phases

This roadmap keeps the first build small enough to finish while preserving the larger platform direction.

## Phase 0: Buildable Plan

Goal: make the repo ready to implement.

- Rewrite specs around the CLI-first hosted MVP.
- Mark old platform features as future work.
- Define Worker boundaries, route list, schema, admin flow, and acceptance tests.
- Convert the spec into build issues once the docs settle.

Exit criteria:

- `docs/specs/mvp.md`, `api.md`, `admin.md`, `data-model.md`, `content-rendering.md`, and `acceptance.md` agree on the MVP.
- Future features are explicitly parked in this roadmap.

## Phase 1: CLI-First MVP

Goal: prove the artifact handoff loop.

- Public CLI: `publish`, `whoami`.
- Public auth: API key only.
- Admin auth: noninteractive `AGENT_PASTE_ADMIN_TOKEN`.
- Workers: `api`, `upload`, `content`.
- Storage: private R2.
- Metadata: Postgres through Cloudflare Hyperdrive using Drizzle.
- Publish: single HTML file or folder with `index.html`.
- Output: `artifact_id`, `revision_id`, direct signed `view_url`, public signed `agent_view_url`, `expires_at`.
- Agent View: simple JSON with full per-file URLs.
- Retention: default `30d`, max `90d`, scheduled cleanup.
- Admin: internal REST APIs plus repo-local admin CLI.
- Events: lightweight operation events, future-expandable into audit.

Exit criteria:

- A real hosted publish can be shared with a human and inspected by another agent.
- Expired artifacts and abandoned uploads are cleaned up.
- The system can be operated without a dashboard.

## Phase 2: Operational MVP+

Goal: make the hosted service easier to run without changing the product shape.

- Improve admin CLI ergonomics and output formats.
- Add repair/backfill commands when real operations reveal gaps.
- Make operation events more queryable.
- Harden request IDs, structured logs, and token redaction checks.
- Tighten rate limits.
- Expand integration tests across preview.
- Add Markdown/text rendering only if it is cheap and demanded by usage.

Exit criteria:

- Routine operations can be handled through the admin CLI with Codex assistance.
- Observability is good enough to debug failed publishes and cleanup.

## Phase 3: Public Product Basics

Goal: let people use the service without manual operator setup.

- Public OAuth login for CLI.
- `agent-paste login`.
- Self-serve workspace creation.
- Public API-key creation/revocation flow.
- Workspace usage and retention settings.
- Minimal account surface only if CLI-only flows become painful.

Exit criteria:

- A new user can start without operator-created credentials.
- API-key auth remains supported for agents and CI.

## Phase 4: Artifact Lifecycle

Goal: graduate from standalone publishes to managed artifacts.

- Multi-revision artifacts.
- Publish update to an existing artifact.
- Revision-pinned links remain stable.
- Latest-moving share links.
- Link mint/re-mint and revoke.
- Fragment-based Access Link Signed URLs.
- Access Link Lockdown.
- Bundle generation/download.

Exit criteria:

- The platform supports both "this exact thing" and "the latest thing" link semantics.
- Link lifecycle is manageable without leaking credentials into server logs.

## Phase 5: MCP Integration

Goal: let hosted agents publish and inspect artifacts through MCP once the core API is proven.

- OAuth-only MCP server.
- Text/HTML publish tools first.
- Read Agent View tool.
- List/manage artifact tools.
- No binary/folder MCP until protocol support and product need are clear.

Exit criteria:

- A hosted agent can publish and inspect artifacts without using the public CLI.
- MCP behavior reuses the proven API and artifact contracts.

## Phase 6: Platform Hardening

Goal: take the security, abuse, and enterprise-shaped pieces seriously once there is usage.

- App-layer encryption.
- Key rotation.
- Real safety scanner integration.
- Abuse/takedown operator flows.
- Stronger audit log semantics.
- Dashboard, if repeated workflows justify UI.
- Billing, quotas, and plans only when costs or external users force the issue.

Exit criteria:

- The system has the controls needed for broader external use.
- Dashboard and billing exist only if they solve observed operational or customer problems.
