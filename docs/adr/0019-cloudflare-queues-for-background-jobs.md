# Cloudflare Queues for Background Jobs

Background product work will use Cloudflare Queues, consumed by the `jobs` app. This keeps asynchronous work inside the Cloudflare platform while separating request/response Workers from cleanup, scanning, retention, and generated artifact maintenance.

## Consequences

- `jobs` should consume queue messages for artifact byte purge, safety scanning, retention cleanup, and generated bundle maintenance.
- Revision bundles should be generated asynchronously after publish or update and stored in R2 as derived objects.
- Cheap safety warnings should be produced synchronously during upload finalization or publish, while deeper safety scans should run asynchronously and update warnings later.
- Queued work that performs durable business writes should use `runCommand` with an explicit system actor.
- Queue handlers should emit structured operational logs and produce audit events when they change product state.
- Preview infrastructure cleanup remains a GitHub Actions responsibility rather than a product queue concern.
