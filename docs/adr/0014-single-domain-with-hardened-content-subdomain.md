# Single Domain with Hardened Content Subdomain

The MVP will use the purchased `agent-paste.sh` domain rather than buying a separate registrable domain for artifact content. Untrusted artifact content will still be served from a dedicated content subdomain, and the platform must compensate for the shared parent domain with strict cookie, CORS, CSP, and routing controls.

## Consequences

- The MVP web app uses `app.agent-paste.sh` and includes the dashboard, the `/al/{publicId}` **Access Link** landing route from [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md), and the `/admin/...` operator surface from [ADR 0046](./0046-operator-identity-and-web-admin-surface.md).
- The apex `agent-paste.sh` serves only marketing/docs and a 308 redirect to `app.agent-paste.sh` for any path that resolves to product surfaces. The apex never hosts authenticated state, never receives Auth0 callbacks, and never sets cookies.
- The control API uses `api.agent-paste.sh`.
- The upload API uses `upload.agent-paste.sh`.
- Artifact content uses `usercontent.agent-paste.sh`.
- Auth cookies must be host-only on `app.agent-paste.sh` and must not be scoped to `.agent-paste.sh`.
- The content subdomain must not receive app authentication cookies or expose privileged CORS access to app/API origins.
- This decision can be revisited later if a separate user-content domain becomes worth the cost.
