# commands

Transactional command wrapper package.

Responsibilities:

- `runCommand` transaction sequencing.
- Idempotency record claim/replay.
- Audit Event collection and write.
- In-memory idempotency helpers for local/test flows.
- Operation event construction helpers.

Durable business writes in `api`, `upload`, and `jobs` use this package for
transaction sequencing, idempotency, and audit events.
