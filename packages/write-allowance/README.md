# write-allowance

Strongly consistent per-workspace daily new-Artifact write allowance counters.

Responsibilities:

- Durable Object-backed daily quota enforcement for publish paths.
- In-memory namespace for local MVP and unit tests.
- Shared counter state helpers used by the DO and memory adapter.

This package should not own publish business logic or usage-policy tier resolution.
