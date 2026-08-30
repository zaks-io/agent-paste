# Implementation Contracts

This document names the contract surfaces an implementer should treat as canonical. Product language still lives in [`CONTEXT.md`](../../CONTEXT.md), and architectural intent still lives in [`docs/adr`](../adr/). The executable contract shape begins in [`packages/contracts`](../../packages/contracts).

## Source Of Truth

`packages/contracts` owns the CLI-first MVP contract surface:

- Branded identifier schemas.
- Stable enum values.
- Request and response Zod schemas.
- Runtime route registry for `whoami`, usage policy, public Agent View, upload-session create/finalize, content reads, web/dashboard routes, billing routes, and operator-only admin routes.

The public OpenAPI documents generated from these contracts intentionally omit
operator-only admin routes and schemas; the runtime registry remains the
enforcement source for those routes.

The first implementation pass should import schemas from this package instead of creating local route-only shapes. Hono/OpenAPI route definitions can wrap these schemas, but they should not re-declare them.

The registry includes publish, dashboard/auth, Bundle, multi-Revision lifecycle,
billing, MCP, and app-layer encryption contracts. Access Link and viewer routes
are retired and are not registered.

## Wire Rules

- JSON bodies use `snake_case`.
- TypeScript call sites may expose camelCase wrappers in `packages/api-client`, but wire schemas stay snake_case.
- Errors always use `{ error: { code, message, docs?, request_id } }`.
- Mutating routes that create durable state require `Idempotency-Key` unless the route registry marks them otherwise.
- List routes use cursor pagination with `cursor`, `limit`, and a response-level `page_info`.
- All success responses echo `X-Request-Id`.
- Public Artifact reads fail closed under active Platform Lockdown: callers
  receive the same generic `not_found` response as any missing or invalid
  target, and no Artifact metadata is returned.
- Authenticated Workspace Member Agent View reads may include explicit lockdown
  metadata so dashboard surfaces can explain why content is dark. Signed content
  URLs still carry workspace and Artifact identifiers so the `content` Worker
  enforces `wsd:` and `ad:` denylist keys before serving bytes.

## ID Formats

| Identifier                | Shape                             | Notes                                                                                                                                                                                          |
| ------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkspaceId`             | UUID                              | Tenant boundary and Postgres RLS setting.                                                                                                                                                      |
| `ArtifactId`              | `art_{26-char ULID}`              | Public, non-secret.                                                                                                                                                                            |
| `RevisionId`              | `rev_{26-char ULID}`              | Public, non-secret.                                                                                                                                                                            |
| `UploadSessionId`         | `upl_{26-char ULID}`              | Public, non-secret.                                                                                                                                                                            |
| `ApiKeyId`                | `key_{26-char ULID}`              | Public row id, not the bearer secret.                                                                                                                                                          |
| `OperationEventId`        | `evt_{26-char ULID}`              | Internal operations record id.                                                                                                                                                                 |
| `ClaimTokenId`            | `ct_{26-char ULID}`               | Public `claim_tokens` row id, not the secret. Ephemeral-publish ([ADR 0075](../adr/0075-agent-first-ephemeral-publish-and-write-gated-monetization.md)).                                       |
| `Agent Credential bearer` | `ap_pk_{env}_{publicId}_{secret}` | Secret-bearing credential.                                                                                                                                                                     |
| `Claim Token bearer`      | `ap_ct_{env}_{publicId}_{secret}` | Secret-bearing one-time claim credential, returned once to the provisioning caller. Ephemeral-publish ([ADR 0075](../adr/0075-agent-first-ephemeral-publish-and-write-gated-monetization.md)). |

ULID text is uppercase Crockford base32 excluding ambiguous characters.

Historical identifier families:

- `AccessLinkId` and `AccessLinkPublicId` remain only in dormant migration data;
  current routes do not expose them.
- `WorkspaceMemberId` for Phase 3 OAuth/self-serve workspace membership.
- `AuditEventId` if `operation_events` graduates into a fuller audit log.
- Bundle availability shapes for Phase 4 bundle generation.

## Change Control

Adding an optional response field is non-breaking. Removing a field, changing a field type, renaming an enum value, changing an ID format, or changing an error code is breaking and requires a `/v2` route family. The one early-alpha exception is the explicit contract reset accepted in ADR 0094, which removes the viewer and Access Link vocabulary instead of preserving a second publish contract.

When adding a new route:

1. Add or reuse Zod schemas in `packages/contracts`.
2. Add the route to `routeContracts`.
3. Add the route to [`api.md`](./api.md).
4. Add acceptance coverage in [`acceptance.md`](./acceptance.md).
5. Generate OpenAPI from the route implementation after handlers exist.
