# commands

Transactional command wrapper package.

Responsibilities:

- `runCommand` transaction sequencing.
- Idempotency record claim/replay.
- Audit Event collection and write.
- In-memory idempotency helpers for local/test flows.
- Operation event construction helpers.

Every durable business write in `api` and `upload` goes through this package. `jobs` will use the same path when it is promoted beyond scaffold status.
