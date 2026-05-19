# Single Domain with Hardened Content Subdomain

The MVP will use the purchased `agent-paste.sh` domain rather than buying a separate registrable domain for artifact content. Untrusted artifact content will still be served from a dedicated content subdomain, and the platform must compensate for the shared parent domain with strict cookie, CORS, CSP, and routing controls.

## Consequences

- The MVP web app uses the apex domain `agent-paste.sh` and includes dashboard plus lightweight marketing or docs surfaces.
- The control API uses `api.agent-paste.sh`.
- The upload API uses `upload.agent-paste.sh`.
- Artifact content should use `usercontent.agent-paste.sh`.
- Auth cookies must be host-only and must not be scoped to `.agent-paste.sh`.
- The content subdomain must not receive app authentication cookies or expose privileged CORS access to app/API origins.
- This decision can be revisited later if a separate user-content domain becomes worth the cost.
