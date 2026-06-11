# MCP Worker with OAuth-Only Access via WorkOS AuthKit

Status: Accepted, with the scope-granting mechanism superseded by [ADR 0079](./0079-mcp-scopes-derived-from-member-role-not-workos-token.md). Provider decided as **WorkOS** by AP-26, consistent with [ADR 0068](./0068-workos-authkit-for-web-app-auth.md). Amended 2026-06-11: MCP publish tools no longer create or reuse Share Links by default; `share` defaults to `false`. This replaces the Auth0 framing this ADR originally carried; the filename is historical.

> **Superseded in part by [ADR 0079](./0079-mcp-scopes-derived-from-member-role-not-workos-token.md).** This ADR assumes the consent screen requests `{write, read, share}` as OAuth scopes and that WorkOS mints them into the token's `scope` claim. WorkOS AuthKit does not issue custom OAuth scopes — `scopes_supported` is fixed to `{email, offline_access, openid, profile}`, and Permissions/Roles are a separate system that never become requestable `scope` values. A caller's granted MCP scopes are therefore derived from their **Workspace Member** role inside `api`, not read from the token. Everything else here — the transport, OAuth-via-AuthKit, CIMD/DCR registration, resource-indicator `aud` binding, the twelve-tool surface, and the `write`/`read`/`share` vocabulary with per-tool requirements — still stands. Where the text below says scopes come from the consent screen or the token `scope` claim, read ADR 0079 instead.

> **Resource indicator note (2026-06-09).** The root Streamable HTTP endpoint is `/`, so the canonical production resource is `https://mcp.agent-paste.sh/`. The no-slash form `https://mcp.agent-paste.sh` remains a WorkOS Resource Indicator compatibility alias, and server-side audience checks normalize trailing slashes.

A new `apps/mcp` Worker on `mcp.agent-paste.sh` terminates the Model Context Protocol (Streamable HTTP transport) and forwards authenticated requests to `api` over a Cloudflare service binding, matching the `web -> api` pattern from [ADR 0059](./0059-web-app-session-and-auth-forwarding-to-api.md). Authentication is OAuth 2.1 only; no **API Key** path is accepted at this surface. WorkOS AuthKit/Connect is the authorization server for MCP, following WorkOS's MCP guidance: <https://workos.com/docs/authkit/mcp>. Client ID Metadata Document (CIMD) is the primary self-identification path for MCP clients; WorkOS Dynamic Client Registration (DCR, RFC 7591) is enabled as compatibility for clients that have not adopted CIMD yet. MCP tokens are minted for the MCP root resource indicator (`https://mcp.agent-paste.sh/`, with no-slash compatibility) and carry explicit **Scopes** (`write read share`), never **Member-Only Scopes**. The MCP server exposes a fixed 12-tool surface limited to text-only artifact operations; binary and multi-file artifacts remain CLI/REST territory.

## Considered Options

- **API Key in `Authorization` header.** Simplest path on the server because `api` already accepts API Keys end-to-end. Rejected because the central motivation for the MCP surface is _not_ having long-lived secrets sitting in third-party host configs (ChatGPT, Claude.ai), which is exactly where pasted API Keys would live.
- **API Key + OAuth dual path.** Lets sophisticated agents pick. Rejected for the same reason: it reintroduces the long-lived-secret surface under the guise of fallback, and there is no MCP use case that genuinely needs an API Key when OAuth is available.
- **OAuth-only with manual WorkOS client per host.** Three hosts on day one, but the platform becomes the bottleneck for the fourth. Rejected; doesn't scale.
- **Stay on Auth0 DCR for MCP while web/CLI use WorkOS.** Keeps the old paper design, but creates two human-auth providers, two sets of operational runbooks, and two token verification paths. Rejected; the project is consolidating human auth on WorkOS.
- **OAuth-only with WorkOS AuthKit/Connect, CIMD primary, DCR compatibility enabled (chosen).** Self-serve host onboarding stays zero-touch for compliant MCP clients, WorkOS owns consent/token issuance, and agent-paste operates one human-auth provider across web, CLI login, and MCP. CIMD is the forward path; DCR remains on because MCP clients will lag the newest auth spec.
- **stdio MCP transport.** Would have let the MCP share the CLI's local credential store, but only works for hosts that can spawn local processes. Rejected because the stated use case includes web-based agent hosts (ChatGPT, Claude.ai) that cannot.

## Consequences

### Transport and worker shape

- **New Worker** `apps/mcp` on `mcp.agent-paste.sh` per [ADR 0014](./0014-single-domain-with-hardened-content-subdomain.md) and [ADR 0006](./0006-small-workers-by-trust-and-scaling-boundary.md). Its trust boundary is "verify the bearer, forward to `api`." It owns no Postgres binding, no R2 binding, no business logic.
- **Protocol.** Streamable HTTP MCP transport. JSON-RPC over `POST /` with `Content-Type: application/json` and optional `Accept: text/event-stream` for streamed responses. The server is **stateless**: every request authenticates independently against its bearer. `Mcp-Session-Id` is accepted but not required and carries no server-side state in v1.
- **Forwarding.** Service binding `MCP → API`. The MCP Worker sets `Authorization: Bearer <verified_jwt>` on the internal call. `api`'s middleware verifies the JWT a second time (it does not trust upstream Workers blindly) and proceeds through the same scope and RLS pipeline as any other authenticated actor.

### Discovery and registration

- **Protected Resource Metadata.** `GET /.well-known/oauth-protected-resource` returns the RFC 9728 document advertising the WorkOS AuthKit domain as the authorization server, the supported scopes (`write`, `read`, `share`), the supported bearer method (`Authorization` header), and `resource=https://mcp.agent-paste.sh/`.
- **Authorization Server Metadata.** The WorkOS AuthKit domain's `/.well-known/oauth-authorization-server` document is the source of truth. `mcp` may proxy `GET /.well-known/oauth-authorization-server` to that WorkOS metadata document for clients that do not yet support Protected Resource Metadata; it does not host its own authorization server metadata.
- **Client ID Metadata Document (CIMD).** CIMD is enabled in the WorkOS Dashboard under Connect configuration and is the preferred client self-identification mechanism. Clients that support CIMD present an HTTPS metadata-document URL as `client_id`; WorkOS reads that document and shows the resulting client identity at consent.
- **DCR compatibility.** DCR is also enabled in the WorkOS Dashboard for clients that have not adopted CIMD. Hosts call the WorkOS AuthKit registration endpoint advertised in authorization-server metadata (`https://<subdomain>.authkit.app/oauth2/register`) with `redirect_uris`, `client_name`, and `token_endpoint_auth_method=none` (public PKCE clients). WorkOS returns a `client_id`; no `client_secret`.
- **Resource Indicator.** `https://mcp.agent-paste.sh/` is configured as the canonical WorkOS Resource Indicator, with `https://mcp.agent-paste.sh` retained as a compatibility alias. `mcp` rejects tokens whose `aud` does not match that resource after trailing-slash normalization.
- **Redirect-URI allowlist.** DCR compatibility registrations are constrained to documented redirect patterns. The current allowlist:
  - `https://chatgpt.com/connector_platform_oauth_redirect`
  - `https://claude.ai/api/mcp/auth_callback`
  - `https://*.claude.ai/api/mcp/auth_callback`
  - `claude-desktop://oauth/callback`
  - `cursor://oauth/callback`
    After this initial set, add host redirects only when their production callback URL is known and documented; placeholders are not accepted in WorkOS configuration. Updates to this allowlist are a WorkOS config change, not a code deploy.
- **Throttling.** WorkOS owns provider-side CIMD/DCR abuse controls. `mcp` does not expose a registration endpoint, so no app-layer registration limiter is added in v1.

### Token shape and authorization

- **Audience.** `aud` matches the MCP root resource indicator (`https://mcp.agent-paste.sh/`, with no-slash compatibility), derived from the WorkOS Resource Indicator.
- **Issuer and JWKS.** `mcp` verifies access tokens against the WorkOS AuthKit issuer (`https://<subdomain>.authkit.app`) and JWKS (`https://<subdomain>.authkit.app/oauth2/jwks`). `api` verifies the forwarded bearer independently.
- **Scopes.** The consent screen requests from `{write, read, share}`. The user picks; WorkOS enforces the granted subset in the issued token's `scope` claim. **Member-Only Scopes** are not in the consent vocabulary and are unreachable from any MCP-minted token.
- **No implicit grant.** `api`'s middleware does NOT apply the **Workspace Member** implicit-grant rule for MCP resource-audience JWTs. The `scope` claim is authoritative. This is the same carve-out [ADR 0060](./0060-cli-authentication-via-auth0-loopback.md) introduces for CLI tokens; [ADR 0034](./0034-unified-scope-model-across-actors.md) records the amended rule.
- **Token lifetime.** Access-token and refresh-token lifetimes are WorkOS AuthKit/Connect environment configuration. MCP code treats them opaquely and relies on standard OAuth refresh behavior in the host.

### Tool surface

Twelve tools, named in snake_case to match common MCP convention. File-bearing operations accept text only.

| Tool                                                                     | Required Scope | Notes                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publish_artifact(title, body, render_mode, share?, idempotency_key?)`   | `write read`   | New **Artifact**, single file. `share` defaults to `false`; set `share: true` only when the user explicitly asks for a public/shareable **Share Link**, returning its **Access Link Signed URL** as `access_link_url`.                        |
| `add_revision(artifact_id, body, render_mode, share?, idempotency_key?)` | `write read`   | New **Revision** on existing **Artifact**. `share` defaults to `false`; set `share: true` only when the user explicitly asks for a public/shareable **Share Link**, reusing an active Share Link when possible or creating one when needed.   |
| `list_artifacts(cursor?)`                                                | `read`         | Paginated, cursor in/out per [ADR 0037](./0037-internal-api-client-package-powers-cli.md)                                                                                                                                                     |
| `read_artifact(artifact_id)`                                             | `read`         | Returns **Agent View**: **Manifest**, file listing, `content_prefix`, **Display Metadata**, **Safety Warnings**, and **Bundle Availability**. It does not inline file bytes or text content; agents fetch needed files from the content URLs. |
| `list_revisions(artifact_id, cursor?)`                                   | `read`         |                                                                                                                                                                                                                                               |
| `delete_artifact(artifact_id)`                                           | `write`        |                                                                                                                                                                                                                                               |
| `update_display_metadata(artifact_id, title)`                            | `write`        | Title-only in this phase; description is returned as `null` on reads until persistence ships.                                                                                                                                                 |
| `create_share_link(artifact_id)`                                         | `read share`   | Returns the **Access Link Signed URL** per [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md)                                                                                                                         |
| `create_revision_link(artifact_id, revision_id)`                         | `read share`   | Pinned link to a specific **Revision**                                                                                                                                                                                                        |
| `list_access_links(artifact_id)`                                         | `read share`   | Returns both **Share Links** and **Revision Links** with a `type` discriminator                                                                                                                                                               |
| `revoke_access_link(access_link_id)`                                     | `share`        | Works on either link type                                                                                                                                                                                                                     |
| `whoami()`                                                               | (any)          | Returns Workspace Member identity, Workspace name, and granted scopes                                                                                                                                                                         |

- **Render Modes accepted by `publish_artifact` and `add_revision`:** `text`, `markdown`, `html`. Code, JSON, YAML, CSV, and other text formats are `text` Render Mode.
- **Entrypoint synthesis.** The MCP picks `index.html` / `index.md` / `content.txt` based on Render Mode; agents do not name the file.
- **No multi-file, no images, no audio/video.** Those Render Modes are reachable only through the CLI or REST API.
- **No `download` / bundle retrieval.** Binary out is not in the MCP surface; agents follow content URLs from `read_artifact` if they need bytes or text content.
- **No `lockdown` controls.** **Access Link Lockdown** is operational; reaching for it from an agent is almost always wrong. Stays CLI/dashboard.

### Idempotency

- **Default.** The MCP server derives the per-call idempotency key from `(token_sub, json_rpc_request_id, tool_name)` and threads it to `api`. Host-transparent retries within a JSON-RPC session collapse to one underlying operation.
- **Explicit override.** `publish_artifact` and `add_revision` accept an optional `idempotency_key` string. When set, the MCP forwards it verbatim instead of deriving one. Agents that need cross-session dedup (e.g., resuming a task by its own task id) use this.
- **Naturally idempotent tools** (`delete_artifact`, `update_display_metadata`, `revoke_access_link`, all reads) do not take or thread idempotency keys.
- **Publish chain.** As with the CLI per [ADR 0037](./0037-internal-api-client-package-powers-cli.md), one user-visible publish key threads through `upload.session.create`, `upload.session.finalize`, and `api.publish`. MCP publish defaults to no Share Link. When `share: true`, `access_link.create` uses a derived `:share-link` idempotency suffix when it must create a **Share Link**. `add_revision` first reuses an active Share Link when one exists, so explicit share retries do not mint duplicate live handoff links.

### Auth gap behavior

- Missing, malformed, expired, or wrong-audience bearer → `401 Unauthorized` with `WWW-Authenticate: Bearer realm="mcp.agent-paste.sh", error="invalid_token", resource_metadata="https://mcp.agent-paste.sh/.well-known/oauth-protected-resource"` per the MCP authorization spec and RFC 6750. Compliant hosts re-trigger their OAuth flow automatically.
- Scope insufficiency → JSON-RPC error with `code: "insufficient_scope"` per [ADR 0036](./0036-error-envelope-and-generic-404-boundary.md) shape, plus the same `WWW-Authenticate` challenge to suggest a re-consent with broader scopes.

### Audit, rate limiting, observability

- **Audit.** MCP-driven mutations are recorded with `actor.type='member'` and `actor_id` as the resolved **Workspace Member** id per [ADR 0034](./0034-unified-scope-model-across-actors.md). The audience (`aud=mcp`) is not a glossary or schema concept; it appears in operational logs for correlation only.
- **Rate limits.** **Actor Rate Limit** and **Workspace Burst Cap** from [ADR 0039](./0039-authenticated-rate-limits-under-usage-policy.md) apply identically; the actor is the resolved Workspace Member. MCP introduces no new rate-limit dimension in v1. (A future per-host or per-OAuth-client dimension is conceivable but not needed to ship.)
- **Logging.** Operational logs per [ADR 0011](./0011-cloudflare-first-observability.md) include `request_id`, `tool_name`, `actor_id`, `aud`, and the upstream `api` request id. JWT bytes, refresh tokens, and idempotency-key values are never logged.

### What this ADR does not introduce

- No new glossary noun. The MCP-authenticated caller is a **Workspace Member**; the audience is transport detail.
- No new **Scope** values. The MCP reuses `write`, `read`, `share` from the existing scope registry.
- No new audit `actor.type`. The carve-out is in scope evaluation, not actor classification.
- No shared credential with the CLI. CLI's [ADR 0060](./0060-cli-authentication-via-auth0-loopback.md) storage is local-machine-only; MCP runs remotely and has no access to it.

### What this ADR explicitly leaves for later

- Per-host rate limits beyond the Workspace floor.
- Stateful MCP sessions (resource subscriptions, sampling, prompts surface).
- Operator visibility into per-host token usage from the dashboard.
- libsecret/Linux keyring storage for the CLI (also out of [ADR 0060](./0060-cli-authentication-via-auth0-loopback.md)).
