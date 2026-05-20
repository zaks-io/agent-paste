# Versioned Public REST APIs

Status: Accepted. Updated by [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md) to remove server-visible Access Link bearer tokens.

Public REST endpoints for the control API and upload API will be versioned in the URL path from the start, beginning with `/v1`. This gives external agents, SDKs, CLIs, and integrations a stable compatibility boundary as the platform evolves.

## Consequences

- `api.agent-paste.sh` public REST routes should start under `/v1`.
- `upload.agent-paste.sh` public REST routes should start under `/v1`.
- Human-facing artifact and access-link URLs should remain clean, while machine-readable Agent View endpoints should use versioned routes.
- Access-link based Agent View discovery uses `POST /v1/access-links/resolve` with the fragment payload from an **Access Link Signed URL**. The fragment is never sent to a server by navigation, and callers must not log the full URL.
- Logs and audit summaries may store Access Link `publicId` values, but must never store full **Access Link Signed URLs**, fragment payloads, content-gateway tokens, or API Key secrets.
- OpenAPI documents should describe versioned public endpoints.
