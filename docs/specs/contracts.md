# Implementation Contracts

This document names the contract surfaces an implementer should treat as canonical. Product language still lives in [`CONTEXT.md`](../../CONTEXT.md), and architectural intent still lives in [`docs/adr`](../adr/). The executable contract shape begins in [`packages/contracts`](../../packages/contracts).

## Source Of Truth

`packages/contracts` owns:

- Branded identifier schemas.
- Stable enum values.
- Request and response Zod schemas.
- Public route registry for `api`, `upload`, `content`, and operator routes.
- MCP tool input/output schemas and tool registry.

The first implementation pass should import schemas from this package instead of creating local route-only shapes. Hono/OpenAPI route definitions can wrap these schemas, but they should not re-declare them.

## Wire Rules

- JSON bodies use `snake_case`.
- TypeScript call sites may expose camelCase wrappers in `packages/api-client`, but wire schemas stay snake_case.
- Errors always use `{ error: { code, message, docs?, request_id } }`.
- Mutating routes that create durable state require `Idempotency-Key` unless the route registry marks them otherwise.
- List routes use cursor pagination with `cursor`, `limit`, and a response-level `page_info`.
- All success responses echo `X-Request-Id`.

## ID Formats

| Identifier | Shape | Notes |
|---|---|---|
| `WorkspaceId` | UUID | Tenant boundary and Postgres RLS setting. |
| `ArtifactId` | `art_{26-char ULID}` | Public, non-secret. |
| `RevisionId` | `rev_{26-char ULID}` | Public, non-secret. |
| `UploadSessionId` | `upl_{26-char ULID}` | Public, non-secret. |
| `AccessLinkId` | `al_{26-char ULID}` | Internal row id. |
| `AccessLinkPublicId` | 16-char Crockford base32 | URL path segment, log-safe. |
| `ApiKeyId` | `key_{26-char ULID}` | Public row id, not the bearer secret. |
| `WorkspaceMemberId` | `wm_{26-char ULID}` | Public inside authenticated workspace surfaces. |
| `AuditEventId` | `aud_{26-char ULID}` | Public inside authenticated audit surfaces. |
| `API Key bearer` | `ap_pk_{env}_{publicId}_{secret}` | Secret-bearing credential. |

ULID text is uppercase Crockford base32 excluding ambiguous characters.

## Canonical Bundle Shape

The canonical public **Bundle Availability** shape is the discriminated union in `packages/contracts/src/agentView.ts`:

- `disabled`
- `pending` with optional `retry_after_seconds`
- `failed` with no public error detail
- `ready` with `url`, `size_bytes`, and `generated_at`

This follows [ADR 0050](../adr/0050-bundle-availability-and-asymmetric-dlq-consumption.md). Any older wording that mentions public `error_code` or `bytes` should be read as superseded by this contract.

## Change Control

Adding an optional response field is non-breaking. Removing a field, changing a field type, renaming an enum value, changing an ID format, or changing an error code is breaking and requires a `/v2` route family.

When adding a new route:

1. Add or reuse Zod schemas in `packages/contracts`.
2. Add the route to `routeContracts`.
3. Add the route to [`api.md`](./api.md).
4. Add acceptance coverage in [`acceptance.md`](./acceptance.md).
5. Generate OpenAPI from the route implementation after handlers exist.
