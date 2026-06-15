# MCP Scopes Are Derived From The Member's Workspace Role, Not From WorkOS Token Scopes

Status: Accepted, with the tool surface and scope vocabulary later amended by [ADR 0084](./0084-cli-and-mcp-share-one-publish-path.md), [ADR 0086](./0086-publish-is-content-only-private-first.md), and [ADR 0091](./0091-client-side-revise-engine-and-literal-edit-tools.md). Supersedes the scope-granting mechanism of [ADR 0061](./0061-mcp-worker-with-oauth-only-via-auth0-dcr.md). The MCP transport, OAuth-via-AuthKit, CIMD/DCR registration, and resource-indicator audience binding are retained from ADR 0061. The shipped MCP capability vocabulary is the shared API vocabulary (`read`, `publish`, `admin`), and the current tool surface is the registry in [`packages/contracts/src/mcp/registry.ts`](../../packages/contracts/src/mcp/registry.ts). The core decision here is the **source** of a caller's granted scopes: not a WorkOS-issued `scope` token claim, but the caller's **Workspace Member** record inside `api`.

> **Amendment (private-first publish, [ADR 0086](./0086-publish-is-content-only-private-first.md)):** The `write`/`read`/`share` MCP scope vocabulary referenced in the original decision has since been **unified with the API scope vocabulary** (`read`/`publish`/`admin`). There is now **one** scope set shared by `api` and MCP: a member's MCP scopes **are** their stored API scopes verbatim. The translation layer described below (`apiScopesToMcpScopes` / `mcpScopesToApiScopes`) has been **removed** — there is nothing to map. Scope meaning is now canonical: `read` = view your stuff; `publish` = change your stuff, **including managing an Artifact's own unauthenticated access** (`set_visibility`, list and revoke that Artifact's links — these are `publish`-scope actions, **not** `admin`); `admin` = account/workspace management (API keys, settings, audit, billing). The decision below (scopes are derived from the member, not the WorkOS token; the Worker verifies issuer + audience only and pre-flight-gates against `mcp.whoami`) **still holds** — only the vocabulary and the now-deleted translation step changed.

ADR 0061 assumed the MCP consent screen would request from `{write, read, share}` and that WorkOS would mint those into the access token's `scope` claim, which both `apps/mcp` and `api` would read. That assumption is wrong for how WorkOS AuthKit actually works, and the entire authenticated MCP surface is non-functional as a result.

## What is actually true about WorkOS AuthKit and MCP

Verified against the live AuthKit tenants (`soulful-path-50.authkit.app` production, `courageous-milestone-75-staging.authkit.app` staging) and the official WorkOS MCP guide (<https://workos.com/docs/authkit/mcp>):

- **AuthKit's authorization server advertises a fixed `scopes_supported` of `["email", "offline_access", "openid", "profile"]`.** There is no dashboard setting that adds custom OAuth scopes (`read`, `write`, `share`) to this set. Requesting any of them at `/oauth2/authorize` returns `error=invalid_scope` before the login page renders, independent of the user, their role, or any permission configuration.
- **WorkOS Permissions and Roles are a separate system from OAuth scopes.** Creating `read`/`write`/`share` Permissions and attaching them to a Role surfaces them as a `permissions` claim derived from role assignment. It does **not** make them requestable OAuth `scope` values. There is no dashboard control that bridges the two.
- **The official WorkOS MCP integration uses no custom scopes.** Its documented token-verification sample checks `issuer` and `audience` only — no scope check at the resource server. Authorization beyond "is this a valid member token for this resource" is the application's responsibility.
- **The resource indicator drives `aud`.** Configuring the MCP root resource as a WorkOS Resource Indicator makes AuthKit mint tokens with a matching MCP `aud`. The canonical production root resource is now `https://mcp.agent-paste.sh/`, with `https://mcp.agent-paste.sh` retained as a compatibility alias because older clients and manual overrides may request it. Without a matching Resource Indicator, AuthKit ignores the `resource` parameter and stamps a default environment audience. This part of ADR 0061 is correct and is retained.

The consequence: `identity.mcp_scopes` (read from the WorkOS token in `apps/api/src/routes/account.ts`) and `parseMcpScopeClaim(payload.scope)` (read from the WorkOS token in `apps/mcp/src/workos.ts`) are both always empty for a real AuthKit token. Every scope-gated tool returns `insufficient_scope`. The defect spans both Workers, not just `mcp`.

## Decision

Keep per-tool `requiredScopes`, but use the shared API scope vocabulary (`read`, `publish`, `admin`) directly. Change where a caller's granted scope set comes from.

- **`api` is the single source of truth for a member's scopes.** `api` resolves the **Workspace Member** from the verified WorkOS token (`sub`) and reads the member's stored API scopes (`scopes: Array<"publish"|"read"|"admin">`, the existing per-member capability model; there is no separate `role` field on a member today). The `mcp.whoami` route (`mcpWhoami` in `apps/api/src/routes/account.ts`) returns this set in its `scopes` field instead of `identity.mcp_scopes`. A future read-only member is a change to that member's stored scopes (or, if a role layer is introduced later, to a role→scope map) in one place — no token, dashboard, or Worker change.
- **The MCP Worker verifies issuer + audience only**, matching the official WorkOS sample. It stops reading scopes from the token (`verifyMcpOAuthToken` no longer calls `parseMcpScopeClaim`). The `mcpScopeClaimIncludesMemberOnlyScopes` rejection is removed; member-only scopes can never appear on an AuthKit token, and the role→scope mapping is the only scope source.
- **The Worker keeps edge pre-flight gating.** Before forwarding a tool call, the Worker fetches the member's derived scope set from `api` (via `mcp.whoami`) and checks the tool's `requiredScopes`, returning `insufficient_scope` early. This preserves clean errors and prevents multi-step tools (the publish chain) from failing partway through. The scope set is resolved once per request and reused across the forwarded calls for that tool.
- **`api` remains the authority.** Edge gating is an optimization, not the security boundary. `api` re-verifies the forwarded bearer and enforces the member's role/RLS on every forwarded call, exactly as it does for web and CLI actors. A Worker that skipped the pre-flight check could not exceed the member's role.

### Shared API/MCP scope vocabulary

The old API→MCP mapping was removed. MCP tool contracts now use the member API
scopes directly:

| Member API scope (stored on the member row) | MCP meaning                                        |
| ------------------------------------------- | -------------------------------------------------- |
| `read`                                      | View the member's own Artifacts and links          |
| `publish`                                   | Create, revise, delete, and manage Artifact links  |
| `admin`                                     | Account/workspace management; no MCP tool needs it |

Members are provisioned with `DEFAULT_MEMBER_SCOPES = ["publish","read","admin"]`,
so today every member resolves to the full shared set. Introducing a read-only
member is a change to that member's stored scopes in one place, with no token,
dashboard, or Worker change.

> The ADR title says "role"; there is no distinct `role` field on a member today — the member's stored API `scopes` array _is_ the capability model. If a separate role layer is added later, it becomes the input to this same mapping.

## Considered options

- **Derive scopes from the member's role in `api`, gate at the edge (chosen).** Matches the official WorkOS pattern, keeps the scope vocabulary and per-tool gating, puts the role→scope authority in `api` where the role and RLS already live, and unblocks every MCP host because the OAuth flow only ever requests AuthKit's supported scopes. Hosts complete consent; `aud` binds correctly; tools authorize against real role.
- **Read scopes from the WorkOS `permissions` claim.** AuthKit can emit a role-derived `permissions` claim. Rejected: it still couples MCP authorization to WorkOS role/permission configuration that must be kept in sync per environment by hand, duplicates the role model that `api` already owns, and was the configuration drift that made this defect so hard to diagnose. Deriving from the member row in `api` has one source of truth.
- **WorkOS Standalone Connect with consent-time scope narrowing.** Standalone Connect (documented in the WorkOS MCP guide) would let the consent screen offer a narrowable subset, preserving ADR 0061's "user picks scopes at consent" goal. Rejected for now: it is materially more wiring (a Login URI, the completion API, custom consent), and pre-launch there is no host that needs a narrower-than-role token. Left as the documented upgrade path if per-host scope narrowing is ever required.
- **Drop scope gating entirely, let `api` reject.** Simplest Worker. Rejected: multi-step tools (the publish chain mints upload sessions, finalizes, publishes, and creates links) could fail mid-chain with a worse error and partial side effects. Edge pre-flight gating is cheap and keeps tool errors clean.

## Consequences

- **`apps/api`**: `mcpWhoami` returns role-derived scopes, not `identity.mcp_scopes`. A role→scope mapping is added beside the role model. The `identity.mcp_scopes` field and its token-claim plumbing are removed (pre-launch; no back-compat per project stage).
- **`apps/mcp`**: `verifyMcpOAuthToken` verifies issuer + `aud` and returns `{ tokenSub }` only — no `scopes`. The auth context's scope set is populated by a `mcp.whoami` call. `parseMcpScopeClaim` and `mcpScopeClaimIncludesMemberOnlyScopes` usage is removed from the verification path. Per-tool `requiredScopes` gating in `tools.ts` is unchanged; it now reads the whoami-derived set.
- **`packages/contracts`**: the `read`/`publish`/`admin` `McpScope` type, `mcpToolContracts[].requiredScopes`, and the resource-indicator/`WWW-Authenticate` helpers are retained. `parseMcpScopeClaim` and `mcpScopeClaimIncludesMemberOnlyScopes` lose their production caller; keep only if still used by tests, otherwise remove.
- **Protected Resource Metadata advertises AuthKit's OAuth scopes, not the capability vocabulary.** `mcpProtectedResourceMetadata` (and the Worker's discovery doc) emit `scopes_supported: ["openid", "profile", "email", "offline_access"]` — AuthKit's fixed supported set — **not** product capabilities such as `read` or `publish`. The MCP client SDK's scope precedence (`@modelcontextprotocol/sdk`, `authInternal`) is: `WWW-Authenticate` scope → **PRM `scopes_supported`** → the client's own registered default (e.g. mcporter registers `mcp:tools`). So both wrong choices break the flow: advertising product capability scopes makes the client send those and AuthKit returns `invalid_scope`; **omitting `scopes_supported` makes the SDK fall through to the client default (`mcp:tools`), which AuthKit also rejects.** Advertising AuthKit's own scopes is the only value that reaches the consent screen. This is purely the OAuth handshake; member capability (`read`/`publish`/`admin`) is still derived in `api` from the member and never appears as an OAuth scope. The MCP server URL must also be registered as a Resource Indicator in the WorkOS environment, or AuthKit returns `invalid_target`.
- **WorkOS configuration is complete and frozen for MCP**: DCR + CIMD enabled, canonical and no-slash Resource Indicators set per environment. No Permissions, Roles, or custom-scope configuration in WorkOS is required for MCP. The earlier per-environment Permission/Role setup done while diagnosing this is inert for MCP and may be removed.
- **`docs/ops/runbook-mcp-hosts.md`** must drop the implication that consent requests `{write, read, share}` as OAuth scopes and that hosts "grant" scopes at consent. Hosts authenticate; capability follows the member's role.
- **ADR 0061** is narrowed: its scope-granting mechanism is replaced by this ADR; everything else in it stands.

## What this does not change

- The transport, statelessness, service-binding forwarding, and idempotency model from ADR 0061.
- OAuth-via-AuthKit, CIMD-primary / DCR-compat registration, and resource-indicator audience binding.
- `api` as the actor-authorization and RLS authority for every surface ([ADR 0034](./0034-unified-scope-model-across-actors.md)). MCP members remain `actor.type='member'`; only the scope-source changes.
- The per-tool scope requirements. They are retained and enforced; they are now sourced from the member record rather than token claims.
