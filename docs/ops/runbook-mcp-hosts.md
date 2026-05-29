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

| Environment | MCP URL                              | OAuth resource indicator (`aud`) |
| ----------- | ------------------------------------ | -------------------------------- |
| Preview     | `https://mcp.preview.agent-paste.sh` | `https://mcp.agent-paste.sh`     |
| Production  | `https://mcp.agent-paste.sh`         | `https://mcp.agent-paste.sh`     |

Both environments mint tokens for the **production resource indicator**
`https://mcp.agent-paste.sh`. Preview advertises a preview `resource` URL in
Protected Resource Metadata, but token verification still pins `aud` to the
production indicator per ADR 0061.

Discovery:

- `GET /.well-known/oauth-protected-resource` — RFC 9728 metadata (resource,
  authorization servers, supported scopes).
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
3. **Resource indicator** — register `https://mcp.agent-paste.sh` as a valid
   resource so issued tokens carry `aud=https://mcp.agent-paste.sh`.

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

MCP consent requests from `{write, read, share}`. The user selects a subset at
consent; the issued token's `scope` claim is authoritative. **Member-Only
Scopes** (`manage_keys`, `manage_workspace`, `read_audit`) are not offered and
must not appear on MCP tokens.

| MCP scope | Maps to API scopes | Typical tools                                                                          |
| --------- | ------------------ | -------------------------------------------------------------------------------------- |
| `read`    | `read`             | `list_artifacts`, `read_artifact`, `list_revisions`, `whoami`                          |
| `write`   | `publish`          | `publish_artifact`, `add_revision`, `delete_artifact`, `update_display_metadata`       |
| `share`   | `admin` (link ops) | `create_share_link`, `create_revision_link`, `list_access_links`, `revoke_access_link` |

Publishing and revision tools require **`write read share`** together (ADR 0061).
Hosts that grant only `read` can inspect artifacts but cannot publish.

Prerequisite: the WorkOS user must already have a **Workspace Member** row
(created by dashboard sign-in or CLI login). MCP OAuth does not auto-provision
workspaces on first token use.

## Supported hosts

### Cursor

1. Open Cursor MCP settings and add a remote MCP server.
2. Server URL: `https://mcp.agent-paste.sh` (or preview URL for staging).
3. Complete the OAuth flow when prompted. Cursor uses the registered
   `cursor://oauth/callback` redirect.
4. Grant `write`, `read`, and `share` if you need publish and link tools.
5. Verify with the `whoami` tool, then try `list_artifacts`.

**Quirk:** Cursor may cache OAuth tokens across reconnects. If scopes change,
disconnect and re-authenticate so consent re-runs.

### Claude Desktop

1. Add the MCP server URL in Claude Desktop connector settings.
2. OAuth uses `claude-desktop://oauth/callback` (registered in WorkOS).
3. Grant all three scopes for full publish/link coverage.

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

## Tool surface (initial twelve)

Text-only artifact operations per ADR 0061:

`publish_artifact`, `add_revision`, `list_artifacts`, `read_artifact`,
`list_revisions`, `delete_artifact`, `update_display_metadata`,
`create_share_link`, `create_revision_link`, `list_access_links`,
`revoke_access_link`, `whoami`.

Binary uploads, multi-file artifacts, bundle download, and lockdown controls
remain CLI/REST/dashboard territory.

`publish_artifact` and `add_revision` always return `revision_link_id` and
`revision_link_url` for the published revision. Set `share: true` to also mint an
optional `share_link_url`; `share` does not gate the required Revision Link.

### Publish retries and share-link idempotency

`publish_artifact` and `add_revision` accept an optional tool idempotency key.
The Worker threads that key through upload, publish, and access-link creates.
Revision and share links use derived keys (`:revision-link` and `:share-link`
suffixes) so a retried publish does not mint duplicate links or cross-replay
cached rows between link types. See [ADR 0061](../adr/0061-mcp-worker-with-oauth-only-via-auth0-dcr.md).
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
| `AGENT_PASTE_PRODUCTION_MCP_URL`     | Production MCP base URL override             |
| `AGENT_PASTE_MCP_SMOKE_ACCESS_TOKEN` | Bearer token for authenticated hosted checks |

### MCP unit tests

```sh
pnpm --filter @agent-paste/mcp test
```

## Failure modes

| Symptom                                     | Likely cause                                                     |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `401` + `WWW-Authenticate: invalid_token`   | Missing/expired token, wrong `aud`, or missing WorkOS member row |
| `403` / `insufficient_scope` on tool call   | Token missing required scopes for that tool                      |
| `401` with API key message                  | Host sent an API key; MCP accepts OAuth only                     |
| `401` with `workos_access_token` message    | Host sent a dashboard session token instead of MCP OAuth         |
| `mcp_oauth_verifier_not_configured` (local) | `WORKOS_API_KEY` or JWKS URL missing on MCP Worker               |
| Host OAuth loop never completes             | Redirect URI not allowlisted in WorkOS                           |
| `whoami` succeeds but publish fails         | Token lacks `write read share` together                          |

## Verification boundary

- Local smoke and MCP unit tests are safe for CI and remote agents.
- Hosted preview/production smoke requires explicit credentials and operator
  approval. Do not run `pnpm smoke:mcp:production` from unattended agents
  unless the Linear issue grants access.
