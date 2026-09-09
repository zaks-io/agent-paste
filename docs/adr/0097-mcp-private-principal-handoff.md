# MCP Private Principal Handoff

Status: Accepted and implemented. Amends [ADR 0061](./0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) and [ADR 0079](./0079-mcp-scopes-derived-from-member-role-not-workos-token.md).

## Decision

The `mcp` Worker is the only runtime that accepts and verifies an MCP OAuth
bearer. It strips `Authorization` before crossing a service binding. Tool calls
invoke an allowlisted named Cloudflare RPC method on `McpApiEntrypoint` or
`McpUploadEntrypoint` with three values: a `Request`, the verified WorkOS
subject, and the expected Route ID.

Each downstream entrypoint rejects a Route ID that is not explicitly available
to MCP or whose method and path do not match the Route Contract. It attaches the
subject to a non-enumerable, symbol-keyed request environment visible only within
the Worker invocation. The ordinary registrar then resolves that subject to the
current Workspace Member row and applies the route's scopes, idempotency rules,
and actor/workspace rate limits. Public `api` and `upload` HTTP routes do not
recognize MCP bearers or caller-supplied subject headers.

At the MCP edge, requests with a cross-origin `Origin` are rejected, an explicit
unsupported `MCP-Protocol-Version` is rejected, and a native per-IP rate limit
runs before OAuth verification. Missing or failed rate-limit and OAuth
dependencies fail with `503`; invalid credentials use `401` and an OAuth
challenge. Caller-supplied session IDs are neither reflected nor traced.

JSON-RPC request bodies remain capped at 1 MiB. Tool text inputs are capped at
192 Ki characters so worst-case UTF-8 plus the envelope stays below that limit.
Downstream JSON responses are capped at 512 KiB before parsing.

## Rationale

Forwarding a reusable bearer expanded the credential's blast radius to every
downstream route that happened to recognize its shape. Reverification also made
an upstream WorkOS outage affect each tool call twice. A private named entrypoint
gives the service binding a narrow callable surface while preserving the database
as the authorization authority. Passing only the immutable identity claim avoids
delegating the credential or trusting an HTTP header.

## Consequences

- `api` and `upload` expose only explicit MCP Route IDs over named RPC.
- `upload` no longer receives `WORKOS_API_KEY` or MCP issuer/JWKS configuration.
- Scope changes and membership removal still take effect on the next tool call
  because downstream Workers resolve the current member row.
- Production deploy smoke must include an authenticated MCP `whoami` and
  `list_artifacts` call; a missing user OAuth smoke token fails before deployment.
  WorkOS M2M tokens are not valid for this check because their subject is an
  application rather than a Workspace Member.
- WorkOS redirect allowlists contain exact callback URIs, never wildcard hosts.
