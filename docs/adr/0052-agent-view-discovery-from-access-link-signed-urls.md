# Agent View Discovery from Access Link Signed URLs

Status: Accepted. Renumbered and rewritten from the duplicate ADR 0043 after [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md) replaced code-bearing Access Links with fragment-encoded signed URLs.

A **Revision Link** is the canonical handoff URL for agent-to-agent flows. A receiving agent discovers the **Agent View** from the same **Access Link Signed URL** that a human opens: parse `https://app.agent-paste.sh/al/{publicId}#{blob}`, preserve the fragment, and call `POST /v1/access-links/resolve` with `{ public_id, blob }`. The response is the **Agent View** plus short-lived content-gateway URLs from [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md). There are no code-scoped bearer routes and no `Link: rel="agent-view"` header on `content` responses, because `content` sees only the derived content token and cannot reconstruct the fragment credential.

## Consequences

- The distributed handoff string is the full **Access Link Signed URL** from ADR 0047, including its fragment. Agents must not drop the fragment when normalizing or logging URLs.
- `POST /v1/access-links/resolve` is the unauthenticated Agent View discovery endpoint. It accepts the `public_id` path segment and fragment `blob`; every invalid, expired, revoked, locked, retained, or deleted case returns the generic `not_found` envelope from [ADR 0036](./0036-error-envelope-and-generic-404-boundary.md).
- `GET /v1/artifacts/{id}/agent-view` remains the authenticated member-or-key-scoped surface and is the publisher's follow-up handle. It is never returned through an unauthenticated surface, so the artifact id stays out of distributed link strings.
- The **Publish Result** returns human-usable **Revision Link** and optional **Share Link** signed URLs. Its authenticated `agent_view_link` is for the publishing actor, not for unauthenticated recipients. Recipients derive their **Agent View** through the resolve endpoint above.
- The CLI and internal `api-client` accept an Access Link Signed URL wherever an artifact read URL is expected. They parse `{ publicId, blob }`, call resolve, and then follow the returned content-gateway URLs.
- The **Content Origin** does not emit `Link: rel="agent-view"` for Access Link responses. A `Link` header would either omit the fragment credential and fail, or reintroduce a server-visible bearer URL, which ADR 0047 explicitly removed.
- No `GET /v1/r/{code}/agent-view` or `GET /v1/s/{code}/agent-view` endpoints are created. The `publicId` alone is log-safe but not a credential.

## Considered Options

- **Resolve from the Access Link Signed URL (chosen).** Keeps one capability URL for humans and agents, preserves the fragment-based no-log property from ADR 0047, and lets `api` enforce row-level state before minting content-gateway URLs.
- **Old code-scoped Agent View endpoints: `GET /v1/r/{code}/agent-view` and `GET /v1/s/{code}/agent-view`.** Simple for HTTP clients, but the code becomes a bearer credential in server logs and observability sinks. Rejected because it recreates the leakage class ADR 0047 was written to remove.
- **`Link: rel="agent-view"` from `content`.** Convenient after content fetch, but `content` receives only a short-lived content-gateway token from ADR 0028, not the original Access Link fragment. Rejected because the header cannot authenticate the Agent View request without creating a second bearer route.
- **Content negotiation on a single URL**: `agent-paste.sh/r/{code}` returns rendered content for `Accept: text/html` and **Agent View** JSON for `Accept: application/json`. Rejected: conflates the hardened **Content Origin** (ADR 0001, 0014) with platform API data, blurring the trust boundary and pulling platform JSON into the untrusted-content domain.
- **Publisher picks the URL by audience**: expect the publishing agent to send the **Revision Link** to humans and an authenticated **Agent View** URL to agents. Rejected: the publisher rarely knows whether the recipient is human, agent, or both, and authenticated **Agent View** URLs are not durable unauthenticated handoff links.
