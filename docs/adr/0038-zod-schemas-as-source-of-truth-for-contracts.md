# Zod Schemas as the Source of Truth for HTTP Contracts

Request and response schemas live as Zod schemas in `packages/contracts/`, consumed by `apps/api` and `apps/upload` for route definition and validation via `@hono/zod-openapi`, and by `packages/api-client` for TypeScript type inference via `z.infer`. OpenAPI is a derived artifact emitted from the same schemas rather than a hand-authored contract. This makes TypeScript the canonical contract and the OpenAPI document a generated view, realizing the "shared contracts package" line in ADR 0017 with a concrete tool choice and tightening ADR 0016's OpenAPI direction.

## Consequences

- `packages/contracts/` exports one Zod schema per request and response shape, organized by resource (`artifacts.ts`, `revisions.ts`, `accessLinks.ts`, etc.). `apps/api`, `apps/upload`, and `packages/api-client` all depend on it via `workspace:*`.
- ID-format primitives (`ArtifactId`, `RevisionId`, `AccessLinkId`, `UploadSessionId`, `WorkspaceId`) are exported as branded Zod schemas via `z.string().brand<"ArtifactId">()`. Accidentally passing one ID type where another is expected fails at compile time.
- `apps/api` and `apps/upload` use `@hono/zod-openapi`'s `createRoute()` with the schemas; validation runs at the route edge through its middleware. Each app emits its own OpenAPI 3.1 spec at `/openapi.json` via `app.doc31()`.
- The ADR 0036 error envelope is one Zod schema. The `code` field is a discriminated union of stable snake_case literal types, one per code enumerated in ADR 0036. Adding a code is a Zod literal addition and backward-compatible; renaming requires `/v2` per ADR 0023.
- `packages/api-client` infers TS types via `z.infer<typeof Schema>` and does not import Hono. Backend schema changes propagate to SDK types at the next type-check.
- HTTP bodies on the wire stay snake_case per ADR 0036. The SDK uses Zod `.transform()` at the boundary to expose camelCase types to TS callers; the backend uses `.transform()` in the inverse direction when materializing handler inputs from request bodies if needed.
- Validation runs once at the route edge in `api`/`upload`. The SDK does not duplicate request validation; it relies on TypeScript types and trusts the server to enforce.
- OpenAPI specs are published per-app and joined at the documentation site; they remain a generated artifact for human and non-Node consumers, not a hand-edited source.
- Renaming a schema field requires updating one Zod definition; the backend and SDK both pick up the change at type-check. Field renames are still public-API changes and follow ADR 0023's versioning rules.
