# Agent View Discovery from Access Links

A **Revision Link** is the canonical handoff URL for agent-to-agent flows. The **Agent View** for any **Access Link** is discoverable through two parallel mechanisms: an HTTP `Link: <url>; rel="agent-view"` response header on the link's content response, and a documented derivable URL pattern at `api.agent-paste.sh/v1/{r|s}/{code}/agent-view`. The **Publish Result** is extended with `revision_agent_view_link` and `share_agent_view_link` fields so the publisher receives an audience-appropriate URL for every link it gets back.

## Consequences

- The **Content Origin** emits `Link: <url>; rel="agent-view"` on every **Revision Link** and **Share Link** response. The URL points at the matching code-scoped **Agent View** on the API origin.
- Two new public REST endpoints serve code-scoped **Agent Views**: `GET /v1/r/{code}/agent-view` returns the **Agent View** for the **Revision** pinned by the **Revision Link**; `GET /v1/s/{code}/agent-view` returns the **Agent View** for the latest **Published Revision** under the **Share Link**.
- The code-scoped endpoints are capability URLs that accept the link code as bearer. They do not require an **API Key** or **Workspace Member** session, mirroring the access model of the **Access Link** they shadow. **Access Link Lockdown** and revocation propagate to them.
- `GET /v1/artifacts/{id}/agent-view` remains the authenticated, member-or-key-scoped surface and is the publisher's follow-up handle. It is never returned through an unauthenticated surface, so the artifact id stays out of distributed link strings.
- The **Publish Result** adds two flat fields: `revision_agent_view_link` (always populated, pinned to the just-published **Revision**) and `share_agent_view_link` (populated only when `--share` produced a **Share Link**, follows latest).
- Receiving agents can discover the **Agent View** by either fetching the **Revision Link** and reading the `Link` header, or by applying the documented URL pattern directly. Both paths are stable public contract under ADR 0023.
- `Link` header emission applies across HTML, Markdown, text, image, audio, video, and directory **Render Modes**. It is part of the **Content Origin** response envelope, not part of **Untrusted Content**, so it is platform-controlled data per ADR 0024.
- The header is keyed by the **Access Link** code, not by the underlying revision bytes, so it composes with the revision-immutable caching rules (ADR 0020) without invalidating cached content when a new link is minted for the same revision.

## Considered Options

- **Content negotiation on a single URL**: `agent-paste.sh/r/{code}` returns rendered content for `Accept: text/html` and **Agent View** JSON for `Accept: application/json`. Rejected: conflates the hardened **Content Origin** (ADR 0001, 0014) with platform API data, blurring the trust boundary and pulling platform JSON into the untrusted-content domain.
- **Publisher picks the URL by audience**: omit any discovery; expect the publishing agent to send the **Revision Link** to humans and the **Agent View** URL to agents. Rejected: the publisher rarely knows whether the recipient is human, agent, or both, and the **Agent View** URL on `api.agent-paste.sh` is not meant to be a durable shareable handle.
- **Drop `agent_view_link` from the Publish Result entirely**: rely on derivation or header discovery alone. Rejected as too aggressive for the MVP; coding agents that consume the **Publish Result** expect the URL in the payload and should not have to learn a pattern to use what they just published.
- **Paired-object Publish Result shape (`{ url, agent_view }` per link)**: cleaner long-term symmetry but a costly public-contract change without a second rel-type to justify it. Deferred until a second discoverable surface (e.g., bundle URL) lands.
