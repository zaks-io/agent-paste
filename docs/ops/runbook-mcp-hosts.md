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
the MCP token is verified by issuer + `aud` only. A caller's `read`, `publish`,
and `admin` capability is **derived in `api` from the caller's Workspace Member
scopes** (`mcp.whoami` returns the derived set), not from the token. See
[ADR 0079](../adr/0079-mcp-scopes-derived-from-member-role-not-workos-token.md).

| Member scope | Typical tools                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`       | `whoami`, `list_artifacts`, `read_artifact`, `read_file`, `list_revisions`, `list_access_links`                                                             |
| `publish`    | `publish_artifact`, `add_revision`, `multi_edit`, `delete_artifact`, `update_display_metadata`, `make_public`, `create_revision_link`, `revoke_access_link` |
| `admin`      | No MCP tool requires it today; it is reserved for dashboard/account/workspace management.                                                                   |

Content-changing publish chain tools (`publish_artifact`, `add_revision`,
`multi_edit`) require **`publish read`** and are content-only and private.
Deletion and display metadata updates require `publish`. Link management uses
`publish` plus `read` where the tool needs to inspect the Artifact first. Members
are provisioned with `read`, `publish`, and `admin` (`DEFAULT_MEMBER_SCOPES`), so
today every member has full
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

## Tool surface

Text-only artifact operations per ADR 0061 plus ADR 0090/0091 read/edit parity:

`publish_artifact`, `add_revision`, `multi_edit`, `list_artifacts`,
`read_artifact`, `read_file`, `list_revisions`, `delete_artifact`,
`update_display_metadata`, `make_public`, `create_revision_link`,
`list_access_links`, `revoke_access_link`, `whoami`.

Binary uploads, multi-file artifacts, bundle download, and lockdown controls
remain CLI/REST/dashboard territory.

`publish_artifact` and `add_revision` are content-only and private (ADR 0086):
they take no visibility input and return one link, `private_url` — the
login-walled `/v/<artifactId>` clean viewer. To make an Artifact public, call
`make_public` as a separate step; it mints or reuses the one Share Link and
returns its no-login Access Link Signed URL. The publish result deliberately
omits Artifact IDs, Revision IDs, `revision_content_url`, and `agent_view_url`;
use explicit read/list/link tools when those fields are needed. Use
`create_revision_link` only for a pinned URL to one exact Revision.

### Publish retries and share-link idempotency

`publish_artifact` and `add_revision` accept an optional tool idempotency key.
The Worker threads that key through upload and publish. The separate `make_public`
step uses a derived `:share-link` key so a retried go-public call does not mint
duplicate Share Links. See
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

### mcporter operator smoke

`mcporter` is useful for live hosted smoke checks because it handles OAuth and
shows the remote tool schema:

```sh
mcporter --config ~/.agent-paste/mcporter.json auth agent-paste-prod
mcporter --config ~/.agent-paste/mcporter.json list agent-paste-prod --schema --json
mcporter --config ~/.agent-paste/mcporter.json call agent-paste-prod.whoami --output json
mcporter --config ~/.agent-paste/mcporter.json call agent-paste-prod.list_artifacts --output json
mcporter --config ~/.agent-paste/mcporter.json call agent-paste-prod.read_artifact artifact_id=art_... --output json
mcporter --config ~/.agent-paste/mcporter.json call agent-paste-prod.read_file artifact_id=art_... path=index.html --output json
```

Pass tool input as `key=value` arguments or with `--args '{"artifact_id":"..."}'`.
Do not use flag-shaped input such as `--artifact-id`; `mcporter call` treats tool
arguments differently from normal CLI flags, and the server will receive an empty
or malformed payload.

### MCP unit tests

```sh
pnpm --filter @agent-paste/mcp test
```

## Failure modes

| Symptom                                                                | Likely cause                                                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `401` + `WWW-Authenticate: invalid_token`                              | Missing/expired token, wrong `aud`, or missing WorkOS member row                                                                           |
| `403` / `insufficient_scope` on tool call                              | Member's role lacks required scopes for that tool (derived in `api`)                                                                       |
| `401` with API key message                                             | Host sent an API key; MCP accepts OAuth only                                                                                               |
| `401` with `workos_access_token` message                               | Host sent a dashboard session token instead of MCP OAuth                                                                                   |
| `mcp_oauth_verifier_not_configured` (local)                            | `WORKOS_API_KEY` or JWKS URL missing on MCP Worker                                                                                         |
| Host OAuth loop never completes                                        | Redirect URI not allowlisted in WorkOS or missing Resource Indicator                                                                       |
| `whoami` succeeds but publish fails                                    | Member's role lacks `publish read`                                                                                                         |
| `read_artifact` succeeds but `read_file` returns `storage_unavailable` | API cannot read or decrypt the stored blob; check API R2 binding and `ARTIFACT_BYTES_ENCRYPTION_*` secret parity with upload/content/jobs. |

## Verification boundary

- Local smoke and MCP unit tests are safe for CI and remote agents.
- Hosted preview/production smoke requires explicit credentials and operator
  approval. Do not run `pnpm smoke:mcp:production` from unattended agents
  unless the Linear issue grants access.
