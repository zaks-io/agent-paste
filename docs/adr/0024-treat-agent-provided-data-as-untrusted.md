# Treat Agent-Provided Data as Untrusted

All data provided by agents will be treated as untrusted, including uploaded files, file paths, display metadata, manifest-derived values, and values later shown in audit summaries or Agent View responses. Platform-controlled records may contain agent-provided values, so storing data in Postgres or rendering it through the platform does not make it trusted; every output surface must validate, normalize, sanitize, and escape values for its specific context.

## Consequences

- Uploaded files remain **Untrusted Content** and must be served only through the enforcing content origin.
- Agent-provided metadata such as titles, labels, and file paths must be treated as untrusted input even when stored in platform-controlled records.
- Human UI, Agent View, audit views, logs, URLs, headers, and generated documents must apply context-appropriate escaping instead of reusing raw stored values.
- Sanitization must not be treated as a substitute for origin isolation, access enforcement, or execution policy.
