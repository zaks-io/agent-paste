# commands

Planned transactional command wrapper package.

Responsibilities:

- `runCommand` transaction sequencing.
- Idempotency record claim/replay.
- Audit Event collection and write.
- System actor helpers for jobs.

Every durable business write in `api`, `upload`, and `jobs` goes through this package.
