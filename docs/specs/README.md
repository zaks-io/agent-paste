# Product Specs

These specs describe the current MVP product contract in a readable shape. They are not a replacement for the ADRs.

- [`mvp.md`](./mvp.md): the coherent MVP story, actors, surfaces, user journeys, and acceptance shape.
- [`features.md`](./features.md): quick feature inventory grouped by product area.
- [`style-guide.md`](./style-guide.md): frontend visual and interaction standard.
- [`contracts.md`](./contracts.md): implementation contract source-of-truth rules and ID formats.
- [`api.md`](./api.md): route, auth, scope, idempotency, and publish-flow contract.
- [`data-model.md`](./data-model.md): Postgres table target, RLS rules, indexes, and invariants.
- [`jobs.md`](./jobs.md): cron, queue, DLQ, message, and system-actor contract.
- [`content-rendering.md`](./content-rendering.md): content origin URL, token, MIME, CSP, renderer, and cache rules.
- [`web.md`](./web.md): dashboard, Access Link viewer, first-run key, and operator UI route contract.
- [`local-dev.md`](./local-dev.md): target local bootstrap and command model.
- [`acceptance.md`](./acceptance.md): testable MVP acceptance matrix.

Use [`CONTEXT.md`](../../CONTEXT.md) for domain language. Use [`docs/adr/`](../adr/) for architectural decisions, trade-offs, and implementation-facing detail. If a spec conflicts with an ADR, update the spec or reopen the ADR before implementation.

## Reading Order

1. [`CONTEXT.md`](../../CONTEXT.md)
2. [`mvp.md`](./mvp.md)
3. [`features.md`](./features.md)
4. [`contracts.md`](./contracts.md)
5. [`api.md`](./api.md), [`data-model.md`](./data-model.md), and [`jobs.md`](./jobs.md)
6. Relevant ADRs linked from those specs
7. [`style-guide.md`](./style-guide.md) and [`web.md`](./web.md) before building a human-facing surface
8. [`acceptance.md`](./acceptance.md) before opening an implementation PR
