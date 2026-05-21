# Implementation Contracts

This document names the contract surfaces an implementer should treat as canonical. Product language still lives in [`CONTEXT.md`](../../CONTEXT.md), and architectural intent still lives in [`docs/adr`](../adr/). The executable contract shape begins in [`packages/contracts`](../../packages/contracts).

## Source Of Truth

`packages/contracts` owns:

- Branded identifier schemas.
- Stable enum values.
- Request and response Zod schemas.
- Public route registry for `api`, `upload`, `content`, and admin routes.

The first implementation pass should import schemas from this package instead of creating local route-only shapes. Hono/OpenAPI route definitions can wrap these schemas, but they should not re-declare them.

Future phases may add MCP tool schemas, Access Link schemas, dashboard/auth schemas, and bundle schemas. They are not MVP build gates.

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
| `ApiKeyId` | `key_{26-char ULID}` | Public row id, not the bearer secret. |
| `OperationEventId` | `evt_{26-char ULID}` | Internal operations record id. |
| `API Key bearer` | `ap_pk_{env}_{publicId}_{secret}` | Secret-bearing credential. |

ULID text is uppercase Crockford base32 excluding ambiguous characters.

Future identifier families:

- `AccessLinkId` and `AccessLinkPublicId` for Phase 4 link lifecycle.
- `WorkspaceMemberId` for Phase 3 OAuth/self-serve workspace membership.
- `AuditEventId` if `operation_events` graduates into a fuller audit log.
- Bundle availability shapes for Phase 4 bundle generation.

## Change Control

Adding an optional response field is non-breaking. Removing a field, changing a field type, renaming an enum value, changing an ID format, or changing an error code is breaking and requires a `/v2` route family.

When adding a new route:

1. Add or reuse Zod schemas in `packages/contracts`.
2. Add the route to `routeContracts`.
3. Add the route to [`api.md`](./api.md).
4. Add acceptance coverage in [`acceptance.md`](./acceptance.md).
5. Generate OpenAPI from the route implementation after handlers exist.
