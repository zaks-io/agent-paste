# Versioned Public REST APIs

Public REST endpoints for the control API and upload API will be versioned in the URL path from the start, beginning with `/v1`. This gives external agents, SDKs, CLIs, and integrations a stable compatibility boundary as the platform evolves.

## Consequences

- `api.agent-paste.sh` public REST routes should start under `/v1`.
- `upload.agent-paste.sh` public REST routes should start under `/v1`.
- Human-facing artifact and access-link URLs should remain clean, while machine-readable Agent View endpoints should use versioned routes.
- Access-link based Agent View URLs may carry access tokens in the URL because Access Links are bearer URLs.
- Logs and audit summaries should avoid storing full Access Link URLs or tokens.
- OpenAPI documents should describe versioned public endpoints.
