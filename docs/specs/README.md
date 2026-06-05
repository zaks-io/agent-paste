# Product Specs

These specs describe the current CLI-first MVP and the phases that follow it. The MVP is intentionally smaller than the older platform-shaped plan: hosted service, public CLI, API-key auth, upload sessions, direct signed content URLs, public Agent View, retention, and repo-local admin operations.

- [`mvp.md`](./mvp.md): the CLI-first MVP story, actors, surfaces, journeys, limits, and non-goals.
- [`phases.md`](./phases.md): roadmap from buildable plan through MCP and platform hardening.
- [`admin.md`](./admin.md): internal admin REST APIs and repo-local admin CLI contract.
- [`product-judgment.md`](./product-judgment.md): why to build, why not to build, and the product posture behind the narrower MVP.
- [`features.md`](./features.md): quick feature inventory split into MVP and future phases.
- [`api.md`](./api.md): route, auth, idempotency, and publish-flow contract.
- [`data-model.md`](./data-model.md): Postgres table target, indexes, and invariants.
- [`content-rendering.md`](./content-rendering.md): content origin URL, token, MIME, CSP, and cache rules.
- [`local-dev.md`](./local-dev.md): local bootstrap and command model.
- [`acceptance.md`](./acceptance.md): testable MVP acceptance matrix.

Future-facing specs remain useful but are not MVP build gates:

- [`jobs.md`](./jobs.md): queue/DLQ worker contract and lifecycle sweeps.
- [`web.md`](./web.md): future dashboard/viewer route contract. MVP has no web dashboard or Access Link viewer.
- [`style-guide.md`](./style-guide.md): visual and interaction standard for future human-facing surfaces and renderer pages.
- [`contracts.md`](./contracts.md): implementation contract source-of-truth rules and ID formats.
- [`ephemeral-publish.md`](./ephemeral-publish.md): agent-first ephemeral publish, claim/promote flow, write-gated tiers, and anti-abuse stack ([ADR 0075](../adr/0075-agent-first-ephemeral-publish-and-write-gated-monetization.md)). Post-MVP; lands with or after Phase 3.

**These specs are the current source of truth for how the system behaves.** To learn whether something is enforced, what a table holds, or what a route does, read the spec — it is the consolidated answer, so you do not have to read through the ADR log to reconstruct the latest decision. The specs scoped "current MVP" above are authoritative for present behavior; the "future-facing" specs are marked and are not yet build gates.

Use [`docs/adr/`](../adr/) for the _decision trail_ — why a choice was made and the trade-offs behind it. ADRs are history; their conclusions should already be folded into the relevant spec. If an ADR conflicts with a spec, the spec wins, and the conflict should be fixed by updating the spec (and noting in the ADR that the rationale flows back to it) rather than leaving readers to discover the contradiction. Some ADRs still describe the broader future platform; when implementation starts, either narrow those ADRs or create superseding ADRs for the MVP.

Use [`CONTEXT.md`](../../CONTEXT.md) for domain language.

## Reading Order

1. [`CONTEXT.md`](../../CONTEXT.md)
2. [`product-judgment.md`](./product-judgment.md)
3. [`mvp.md`](./mvp.md)
4. [`phases.md`](./phases.md)
5. [`features.md`](./features.md)
6. [`api.md`](./api.md), [`admin.md`](./admin.md), [`data-model.md`](./data-model.md), and [`content-rendering.md`](./content-rendering.md)
7. [`local-dev.md`](./local-dev.md)
8. [`acceptance.md`](./acceptance.md)
