# MCP Host Onboarding Runbook

Operator and integrator guide for connecting supported MCP hosts to the hosted
agent-paste MCP Worker. Covers OAuth setup, scopes, host-specific quirks, and
smoke verification without exposing secrets.

Scope:

- Preview MCP at `https://mcp.preview.agent-paste.sh`
- Production MCP at `https://mcp.agent-paste.sh`
- WorkOS AuthKit/Connect as the OAuth authorization server ([ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md))

Out of scope:

- Changing the MCP tool surface (see `packages/contracts/src/mcp.ts` and
  `apps/mcp/src/tools.ts`).
- API Key authentication at the MCP surface (rejected by design).

Related docs:

- [ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) — transport, OAuth, tools, and idempotency.
- [WorkOS runbook](./runbook-workos.md) — WorkOS project layout for web/CLI (MCP shares the AuthKit domain).
- [Hosted ops](./status/hosted-ops.md) — deploy order and secrets inventory.
- [`apps/mcp/README.md`](../../apps/mcp/README.md) — Worker endpoints and implementation map.

## MCP endpoint

| Environment | MCP URL                              | Canonical OAuth resource indicator (`aud`) |
| ----------- | ------------------------------------ | ------------------------------------------ |
| Preview     | `https://mcp.preview.agent-paste.sh` | `https://mcp.preview.agent-paste.sh/`      |
| Production  | `https://mcp.agent-paste.sh`         | `https://mcp.agent-paste.sh/`              |

The root Streamable HTTP endpoint is `/`, so the canonical RFC 9728 resource
identifier includes the trailing slash. The Workers also accept no-slash
audiences for old tokens and manual host overrides by normalizing trailing
slashes during token verification.

Discovery:

- `GET /.well-known/oauth-protected-resource` — RFC 9728 metadata (resource,
  authorization servers, supported scopes).
- `GET /.well-known/oauth-authorization-server` and
  `GET /.well-known/openid-configuration` — WorkOS AuthKit metadata facade for
  clients that probe the MCP host directly.
- `GET /healthz` — Worker health (`{"ok":true,"app":"mcp"}`).
- `POST /` — Streamable HTTP MCP transport (JSON-RPC; optional SSE responses).

Transport auth is **OAuth bearer only**. API keys, dashboard session cookies,
and `wos_session_*` tokens are rejected at this surface.

## OAuth and WorkOS configuration

WorkOS AuthKit/Connect is the authorization server. Configure in the matching
WorkOS environment **before** asking hosts to connect.

| Deploy target | WorkOS AuthKit domain                                 |
| ------------- | ----------------------------------------------------- |
| Preview       | `https://courageous-milestone-75-staging.authkit.app` |
| Production    | `https://soulful-path-50.authkit.app`                 |

Required WorkOS Dashboard settings (per environment):

1. **Connect / MCP** — enable Client ID Metadata Document (CIMD) as the primary
   client identification path.
2. **Dynamic Client Registration (DCR)** — keep enabled for hosts that have not
   adopted CIMD yet (RFC 7591 compatibility).
3. **Resource indicators** — register the canonical resource for the target:
   production `https://mcp.agent-paste.sh/`, preview
   `https://mcp.preview.agent-paste.sh/`. Also keep the no-slash aliases
   (`https://mcp.agent-paste.sh`, `https://mcp.preview.agent-paste.sh`) during
   alpha because older host configs and manual overrides may still request them.
   Issued tokens must carry an `aud` matching the target resource, modulo the
   server's trailing-slash normalization.

### Redirect URI allowlist (DCR compatibility)

Documented production callback patterns (WorkOS config change, not a code deploy):

| Redirect URI                                            | Host                 |
| ------------------------------------------------------- | -------------------- |
| `https://chatgpt.com/connector_platform_oauth_redirect` | ChatGPT              |
| `https://claude.ai/api/mcp/auth_callback`               | Claude.ai (web)      |
| `https://*.claude.ai/api/mcp/auth_callback`             | Claude.ai subdomains |
| `claude-desktop://oauth/callback`                       | Claude Desktop       |
| `cursor://oauth/callback`                               | Cursor               |

Add new redirect URIs only when the host's production callback URL is known.
Do not register placeholder URIs.

### Worker secrets

The MCP Worker (`agent-paste-mcp-{preview,production}`) needs:

| Name             | Source                                   |
| ---------------- | ---------------------------------------- |
| `WORKOS_API_KEY` | Same environment WorkOS API key as `api` |

JWKS URL, issuer, audience, and authorization-server metadata are public Worker
vars in `apps/mcp/wrangler.jsonc`. Bootstrap with `pnpm bootstrap:preview
--with-web` (or production) to write `WORKOS_API_KEY` onto the MCP Worker when
WorkOS credentials are available.

Deploy order: `api` and `upload` must exist before `mcp` (service bindings). See
[Hosted ops](./status/hosted-ops.md#deploy-order).

## Scopes

Hosts authenticate via WorkOS AuthKit; they do **not** select scopes at consent.
WorkOS AuthKit cannot issue custom OAuth scopes — the access token carries only
AuthKit's built-in scopes (`openid`, `profile`, `email`, `offline_access`), and
the MCP token is verified by issuer + `aud` only. A caller's `{write, read,
share}` capability is **derived in `api` from the caller's Workspace Member
scopes** (`mcp.whoami` returns the derived set), not from the token. See
[ADR 0079](../adr/0079-mcp-scopes-derived-from-member-role-not-workos-token.md).

| MCP scope | Member API scope | Typical tools                                                                          |
| --------- | ---------------- | -------------------------------------------------------------------------------------- |
| `read`    | `read`           | `list_artifacts`, `read_artifact`, `list_revisions`, `whoami`                          |
| `write`   | `publish`        | `publish_artifact`, `add_revision`, `delete_artifact`, `update_display_metadata`       |
| `share`   | `admin`          | `create_share_link`, `create_revision_link`, `list_access_links`, `revoke_access_link` |

Publishing tools require **`write read`**. `share` is required only for link
management or for publish calls that set `share: true`. Members are provisioned
with all three (`DEFAULT_MEMBER_SCOPES`), so today every member has full
capability; a future read-only or share-less member is a change to that member's
stored scopes in `api`, with no host, token, or WorkOS change. The MCP Worker
pre-flight-gates each tool by fetching the member's derived scopes via
`mcp.whoami`; `api` re-enforces the member's scopes/RLS on every forwarded call.

Prerequisite: the WorkOS user must already have a **Workspace Member** row
(created by dashboard sign-in or CLI login). MCP OAuth does not auto-provision
workspaces on first token use.

## Supported hosts

### Cursor

1. Open Cursor MCP settings and add a remote MCP server.
2. Server URL: `https://mcp.agent-paste.sh` (or preview URL for staging).
3. Complete the OAuth flow when prompted. Cursor uses the registered
   `cursor://oauth/callback` redirect.
4. Verify with the `whoami` tool (it reports the member's derived scopes), then
   try `list_artifacts`. Capability follows the member's role, not a consent
   selection.

**Quirk:** Cursor may cache OAuth tokens across reconnects. If a member's scopes
change in `api`, the next `mcp.whoami` reflects it on the following tool call; no
re-consent is needed.

### Claude Desktop

1. Add the MCP server URL in Claude Desktop connector settings.
2. OAuth uses `claude-desktop://oauth/callback` (registered in WorkOS).
3. Capability follows the member's role; full members get publish/link coverage
   automatically (no scope selection at consent).

**Quirk:** Desktop builds lag web MCP auth spec changes; DCR compatibility must
stay enabled in WorkOS until CIMD support is confirmed for your build.

### Claude.ai (web)

1. Add a custom MCP connector with server URL `https://mcp.agent-paste.sh`.
2. OAuth callback lands on `https://claude.ai/api/mcp/auth_callback` (or a
   documented `*.claude.ai` subdomain pattern).

**Quirk:** Web hosts cannot spawn local processes; do not point Claude.ai at
`stdio` or localhost MCP servers for hosted agent-paste.

### ChatGPT

1. Register the MCP connector with server URL `https://mcp.agent-paste.sh`.
2. OAuth redirect uses `https://chatgpt.com/connector_platform_oauth_redirect`.

**Quirk:** Connector OAuth UX varies by ChatGPT rollout; if discovery fails,
confirm Protected Resource Metadata is reachable from the host's egress.

### Codex

1. Add the remote server: `codex mcp add agent-paste --url https://mcp.agent-paste.sh`.
2. Authenticate: `codex mcp login agent-paste`.
3. Start a fresh Codex session after login so the tool inventory is reloaded.

**Quirk:** Current Codex/rmcp sends the root resource as
`https://mcp.agent-paste.sh/`. Do not require users to pass `--oauth-resource`;
register the trailing-slash Resource Indicator in WorkOS instead. If a user
already logged in before this fix, run `codex mcp logout agent-paste` and login
again.

## Tool surface (initial twelve)

Text-only artifact operations per ADR 0061:

`publish_artifact`, `add_revision`, `list_artifacts`, `read_artifact`,
`list_revisions`, `delete_artifact`, `update_display_metadata`,
`create_share_link`, `create_revision_link`, `list_access_links`,
`revoke_access_link`, `whoami`.

Binary uploads, multi-file artifacts, bundle download, and lockdown controls
remain CLI/REST/dashboard territory.

`publish_artifact` and `add_revision` return `artifact_url` as the stable live
viewer URL. Set `share: true` only when the agent should also mint an optional
`share_link_url`. Use `create_revision_link` for a pinned URL to one exact
Revision.

### Publish retries and share-link idempotency

`publish_artifact` and `add_revision` accept an optional tool idempotency key.
The Worker threads that key through upload and publish. When `share: true`, the
optional Share Link create uses a derived `:share-link` key so a retried publish
does not mint duplicate Share Links. See
[ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md).
Regression coverage: `apps/mcp/src/publish-chain.test.ts` (key forwarding) and
`packages/db/src/member-mcp-operations.test.ts` (repository dedup).

## Smoke commands

Run from the repo root after `pnpm build`.

### Local (no hosted credentials)

Exercises MCP transport, OAuth rejection paths, WorkOS JWT verification, and a
publish/read chain against the in-memory local MVP harness:

```sh
pnpm smoke:mcp
```

Uses ephemeral ports and a local WorkOS JWKS stub. Does not call hosted Workers.

### Hosted preview / production

Unauthenticated checks always run: `/healthz`, Protected Resource Metadata,
missing-bearer `401` + `WWW-Authenticate`, and API-key rejection.

Authenticated tool checks run only when an MCP access token is supplied:

```sh
export AGENT_PASTE_MCP_SMOKE_ACCESS_TOKEN="<oauth-access-token>"
pnpm smoke:mcp:preview
# or, with explicit Isaac approval and production credentials:
pnpm smoke:mcp:production
```

Obtain the smoke token by completing a normal host OAuth flow against the target
environment, then copy the access token from the host's token store or a
one-time OAuth debugging session. **Do not** commit tokens, refresh tokens, or
client secrets. Do not paste token values into Linear or PR comments.

Environment overrides:

| Variable                             | Purpose                                      |
| ------------------------------------ | -------------------------------------------- |
| `AGENT_PASTE_PREVIEW_MCP_URL`        | Preview MCP base URL override                |
| `AGENT_PASTE_PREVIEW_MCP_RESOURCE`   | Preview OAuth resource override              |
| `AGENT_PASTE_PREVIEW_MCP_AUDIENCE`   | Preview token audience override              |
| `AGENT_PASTE_PRODUCTION_MCP_URL`     | Production MCP base URL override             |
| `AGENT_PASTE_MCP_SMOKE_ACCESS_TOKEN` | Bearer token for authenticated hosted checks |

### MCP unit tests

```sh
pnpm --filter @agent-paste/mcp test
```

## Failure modes

| Symptom                                     | Likely cause                                                         |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `401` + `WWW-Authenticate: invalid_token`   | Missing/expired token, wrong `aud`, or missing WorkOS member row     |
| `403` / `insufficient_scope` on tool call   | Member's role lacks required scopes for that tool (derived in `api`) |
| `401` with API key message                  | Host sent an API key; MCP accepts OAuth only                         |
| `401` with `workos_access_token` message    | Host sent a dashboard session token instead of MCP OAuth             |
| `mcp_oauth_verifier_not_configured` (local) | `WORKOS_API_KEY` or JWKS URL missing on MCP Worker                   |
| Host OAuth loop never completes             | Redirect URI not allowlisted in WorkOS or missing Resource Indicator |
| `whoami` succeeds but publish fails         | Member's role lacks `write read`, or lacks `share` for `share: true` |

## Verification boundary

- Local smoke and MCP unit tests are safe for CI and remote agents.
- Hosted preview/production smoke requires explicit credentials and operator
  approval. Do not run `pnpm smoke:mcp:production` from unattended agents
  unless the Linear issue grants access.
