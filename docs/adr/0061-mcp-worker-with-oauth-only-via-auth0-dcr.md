# MCP Worker with OAuth-Only Access via Auth0 DCR

A new `apps/mcp` Worker on `mcp.agent-paste.sh` terminates the Model Context Protocol (Streamable HTTP transport) and forwards authenticated requests to `api` over a Cloudflare service binding, matching the `web → api` pattern from [ADR 0059](./0059-web-app-session-and-auth-forwarding-to-api.md). Authentication is OAuth 2.1 only — no **API Key** path is accepted at this surface. Auth0 Dynamic Client Registration (RFC 7591) is enabled with a redirect-URI allowlist so any agent host (ChatGPT, Claude.ai, Claude Desktop, Cursor, Neuron, future) can self-register without manual platform involvement. MCP tokens are minted under a new audience `https://mcp.agent-paste.sh` and carry explicit **Scopes** (`write read share`), never **Member-Only Scopes**. The MCP server exposes a fixed 12-tool surface limited to text-only artifact operations; binary and multi-file artifacts remain CLI/REST territory.

## Considered Options

- **API Key in `Authorization` header.** Simplest path on the server because `api` already accepts API Keys end-to-end. Rejected because the central motivation for the MCP surface is *not* having long-lived secrets sitting in third-party host configs (ChatGPT, Claude.ai), which is exactly where pasted API Keys would live.
- **API Key + OAuth dual path.** Lets sophisticated agents pick. Rejected for the same reason: it reintroduces the long-lived-secret surface under the guise of fallback, and there is no MCP use case that genuinely needs an API Key when OAuth is available.
- **OAuth-only with manual Auth0 client per host.** Three hosts on day one, but the platform becomes the bottleneck for the fourth. Rejected; doesn't scale.
- **OAuth-only with Auth0 DCR (chosen).** Self-serve host onboarding gated by user consent and a redirect-URI allowlist. The user is the trust boundary at the consent screen; Auth0 shows the client name.
- **stdio MCP transport.** Would have let the MCP share the CLI's local credential store, but only works for hosts that can spawn local processes. Rejected because the stated use case includes web-based agent hosts (ChatGPT, Claude.ai) that cannot.

## Consequences

### Transport and worker shape

- **New Worker** `apps/mcp` on `mcp.agent-paste.sh` per [ADR 0014](./0014-single-domain-with-hardened-content-subdomain.md) and [ADR 0006](./0006-small-workers-by-trust-and-scaling-boundary.md). Its trust boundary is "verify the bearer, forward to `api`." It owns no Postgres binding, no R2 binding, no business logic.
- **Protocol.** Streamable HTTP MCP transport. JSON-RPC over `POST /` with `Content-Type: application/json` and optional `Accept: text/event-stream` for streamed responses. The server is **stateless**: every request authenticates independently against its bearer. `Mcp-Session-Id` is accepted but not required and carries no server-side state in v1.
- **Forwarding.** Service binding `MCP → API`. The MCP Worker sets `Authorization: Bearer <verified_jwt>` on the internal call. `api`'s middleware verifies the JWT a second time (it does not trust upstream Workers blindly) and proceeds through the same scope and RLS pipeline as any other authenticated actor.

### Discovery and registration

- **Protected Resource Metadata.** `GET /.well-known/oauth-protected-resource` returns the RFC 9728 document advertising the Auth0 tenant as the authorization server, the supported scopes (`write`, `read`, `share`), the supported bearer methods (`Authorization` header), and the resource identifier `https://mcp.agent-paste.sh`.
- **Authorization Server Metadata.** Auth0's existing `.well-known/openid-configuration` is the discovery target. No new endpoint on `mcp`.
- **DCR.** Hosts call Auth0's `/oidc/register` directly per RFC 7591 with `redirect_uris`, `client_name`, and `token_endpoint_auth_method=none` (public clients). Auth0 returns a `client_id`; no `client_secret`.
- **Redirect-URI allowlist.** An Auth0 post-registration Action rejects registrations whose `redirect_uris` do not match a documented pattern set. The current allowlist:
  - `https://chatgpt.com/connector_platform_oauth_redirect`
  - `https://claude.ai/api/mcp/auth_callback`
  - `https://*.claude.ai/api/mcp/auth_callback`
  - `claude-desktop://oauth/callback`
  - `cursor://oauth/callback`
  - Neuron's production redirect (TBD at deploy time)
  Updates to this allowlist are an Auth0 config change, not a code deploy.
- **Throttling.** Auth0's built-in DCR rate limit handles abuse; no extra layer in v1.

### Token shape and authorization

- **Audience.** `https://mcp.agent-paste.sh`. New Auth0 application named `agent-paste MCP`.
- **Scopes.** The consent screen requests from `{write, read, share}`. The user picks; Auth0 enforces the granted subset in the issued token's `scope` claim. **Member-Only Scopes** are not in the consent vocabulary and are unreachable from any MCP-minted token.
- **No implicit grant.** `api`'s middleware does NOT apply the **Workspace Member** implicit-grant rule for `aud=https://mcp.agent-paste.sh` JWTs. The `scope` claim is authoritative. This is the same carve-out [ADR 0060](./0060-cli-authentication-via-auth0-loopback.md) introduces for CLI tokens; [ADR 0034](./0034-unified-scope-model-across-actors.md) records the amended rule.
- **Token TTL.** Access token 1 hour, refresh token 30 days with sliding renewal, matching `web` per [ADR 0059](./0059-web-app-session-and-auth-forwarding-to-api.md). Hosts handle refresh transparently to the agent.

### Tool surface

Twelve tools, named in snake_case to match common MCP convention. File-bearing operations accept text only.

| Tool | Required Scope | Notes |
|---|---|---|
| `publish_artifact(title, body, render_mode, share?, idempotency_key?)` | `write read share` (share only when `share=true`) | New **Artifact**, single file |
| `add_revision(artifact_id, body, render_mode, share?, idempotency_key?)` | `write read share` (share only when `share=true`) | New **Revision** on existing **Artifact** |
| `list_artifacts(cursor?)` | `read` | Paginated, cursor in/out per [ADR 0037](./0037-internal-api-client-package-powers-cli.md) |
| `read_artifact(artifact_id)` | `read` | Returns **Manifest**, file listing, **Display Metadata**, **Safety Warnings**, **Bundle Availability**, and inline text content of text-Render-Mode files. Non-text files appear in the listing with their content URLs; bytes are not returned over MCP. |
| `list_revisions(artifact_id, cursor?)` | `read` | |
| `delete_artifact(artifact_id)` | `write` | |
| `update_display_metadata(artifact_id, title?, description?)` | `write` | |
| `create_share_link(artifact_id)` | `read share` | Returns the **Access Link Signed URL** per [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md) |
| `create_revision_link(artifact_id, revision_id)` | `read share` | Pinned link to a specific **Revision** |
| `list_access_links(artifact_id)` | `read share` | Returns both **Share Links** and **Revision Links** with a `type` discriminator |
| `revoke_access_link(access_link_id)` | `share` | Works on either link type |
| `whoami()` | (any) | Returns Workspace Member identity, Workspace name, and granted scopes |

- **Render Modes accepted by `publish_artifact` and `add_revision`:** `text`, `markdown`, `html`. Code, JSON, YAML, CSV, and other text formats are `text` Render Mode.
- **Entrypoint synthesis.** The MCP picks `index.html` / `index.md` / `content.txt` based on Render Mode; agents do not name the file.
- **No multi-file, no images, no audio/video.** Those Render Modes are reachable only through the CLI or REST API.
- **No `download` / bundle retrieval.** Binary out is not in the MCP surface; agents follow content URLs from `read_artifact` if they need bytes.
- **No `lockdown` controls.** **Access Link Lockdown** is operational; reaching for it from an agent is almost always wrong. Stays CLI/dashboard.

### Idempotency

- **Default.** The MCP server derives the per-call idempotency key from `(token_sub, json_rpc_request_id, tool_name)` and threads it to `api`. Host-transparent retries within a JSON-RPC session collapse to one underlying operation.
- **Explicit override.** `publish_artifact` and `add_revision` accept an optional `idempotency_key` string. When set, the MCP forwards it verbatim instead of deriving one. Agents that need cross-session dedup (e.g., resuming a task by its own task id) use this.
- **Naturally idempotent tools** (`delete_artifact`, `update_display_metadata`, `revoke_access_link`, all reads) do not take or thread idempotency keys.
- **Publish chain.** As with the CLI per [ADR 0037](./0037-internal-api-client-package-powers-cli.md), one user-visible publish key threads through `upload.session.create`, `upload.session.finalize`, and `api.publish` — three idempotency records, one operation.

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
