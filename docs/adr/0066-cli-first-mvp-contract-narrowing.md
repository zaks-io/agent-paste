# CLI-First MVP Contract Narrowing

Status: Accepted

The executable contracts in `packages/contracts` are narrowed to the CLI-first MVP. They expose only API-key `whoami`, read-only usage policy, upload-session create/finalize, public signed Agent View, `PublishResult`, content reads, and internal admin workspace/API-key/artifact/cleanup/operation-event routes. Dashboard auth, Access Link lifecycle, MCP tools, bundle availability, safety scanner warnings, multi-revision mutation routes, pinning, lockdowns, and full audit-product routes are deferred until their phases become build gates.

## Follow-Ups To Earlier ADRs

- [ADR 0056](./0056-mvp-usage-policy-defaults-and-platform-caps.md) is narrowed for the CLI-first MVP: file size is `10 MB`, total artifact size is `25 MB`, file count is `100`, artifact TTL is `1d` to `90d` with `30d` default, upload-session TTL is `24h`, and the API-key actor rate-limit target is `60 req/min`. These sit deliberately below the ADR 0056 platform ceilings (`25 MB` file, `100 MB` **Revision**) and can be raised later without touching those ceilings; workspace-tunable policy is future work. Plan-tiered selection arrives in [ADR 0073](./0073-open-core-billing-plan-tiered-usage-policy-disabled-by-default.md): with billing on, these caps split into `free` / `pro`; with billing off, every **Workspace** runs one operator-configurable set that defaults to the `pro` values (file and **Revision** size back at the platform ceilings), not this smaller MVP contract set.
- [ADR 0063](./0063-application-layer-encryption-for-artifact-bytes.md) is deferred for the MVP. MVP bytes remain private in R2, are served only through the isolated content Worker, and never expose direct R2 URLs. App-layer encryption metadata and streaming transforms should not appear in MVP contracts.
- [ADR 0038](./0038-zod-schemas-as-source-of-truth-for-contracts.md) remains true, but the source-of-truth package now reflects the smaller route list from `docs/specs/api.md`, not the broader platform route map.

## Consequences

- `packages/contracts` can be used by the first API, upload, content, CLI, and admin implementations without importing future-only concepts.
- The public Agent View returns full per-file signed URLs and does not include `content_prefix`.
- Finalizing an upload session returns the small `PublishResult` shape printed by the CLI.
- Operation events are lightweight operator records; a fuller audit log remains future work.
