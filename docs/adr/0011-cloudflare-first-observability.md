# Cloudflare-First Observability

Operational observability will start with Cloudflare-native logs, analytics, traces, and metrics. Logs should be structured and include correlation fields so they can later be exported to Axiom or another observability system without changing application logging semantics.

## Consequences

- Each request should have a request identifier propagated across apps, database writes, and audit events where appropriate.
- Apps should emit structured JSON logs rather than human-formatted strings.
- Audit events are product and security records, not a replacement for operational logs.
- Initial alerts should focus on error rate, database connectivity, queue failures, upload finalization failures, and content gateway authorization failures.
- A future Axiom integration should consume the same structured events rather than requiring a new logging model.
