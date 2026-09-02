# Isolate Active Content and Restore the Ephemeral Execution Policy

Status: Accepted and implemented. Amends [ADR 0094](./0094-capability-url-is-the-artifact-link.md) and restores the tier boundary from [ADR 0075](./0075-agent-first-ephemeral-publish-and-write-gated-monetization.md).

## Context

ADR 0094 fixed recurring iframe, opaque-origin, and CSP compatibility failures by
making the capability origin the Artifact URL. It also removed the ephemeral
`script_disabled` policy and placed active user content below the product's
`agent-paste.sh` registrable domain. That widened anonymous abuse, same-site
cookie, domain-reputation, telemetry, and service-worker persistence risks.

Cloudflare URL Scanner is not an active control. Its cost and implementation
work are deferred until usage justifies them.

## Decision

1. Artifact capability hosts and legacy signed content move to the separate
   `agent-paste.link` registrable domain. Existing capability hosts below
   `agent-paste.sh` redirect to the equivalent `.link` host during migration.
   Product, authentication, API, upload, and MCP hosts remain on
   `agent-paste.sh`. `agent-paste.com` redirects to the canonical marketing site.
2. Ephemeral content carries `script_disabled: true` in the signed content
   token. The content Worker selects an explicit restricted CSP that blocks
   scripts, connections, workers, forms, frames, objects, and base-URL changes.
   Missing execution-policy state fails closed. Claim refresh rewrites the
   capability manifest with scripts enabled only after authenticated ownership
   promotion succeeds.
3. Service workers are unsupported on every Artifact tier. Requests for a
   service-worker script receive a self-retiring no-op worker and storage-clear
   headers. Dedicated Web Workers remain available to claimed interactive
   Artifacts under their normal CSP.
4. Automatic Cloudflare invocation logs and traces are disabled on content and
   upload Workers because their URLs contain bearer credentials. Redacted
   application logs remain enabled.
5. URL Scanner submission and scanner-triggered lockdown code are removed from
   the active jobs path. Built-in and Llama Guard warning scans remain advisory.
6. Public-read deletion is acknowledged only after denylisting succeeds;
   idempotent retries rerun invalidation. Claim returns failure when capability
   refresh fails. Artifact read limits use Artifact plus client identity rather
   than one shared Artifact-wide bucket.

## Consequences

- Anonymous static Artifacts keep the direct top-level URL model without gaining
  script, fetch/XHR/WebSocket, form-submission, frame/object embedding, base-URL
  changes, or persistent-worker behavior. External static assets such as images,
  styles, fonts, and media remain allowed.
- Claimed Artifacts retain broad browser compatibility, except for service
  workers. Authentication provides attribution, not a claim that uploaded code
  is safe.
- Moving active content cross-site protects product cookies and the primary
  product domain's reputation. Capability hostnames remain bearer secrets and
  must still be redacted.
- Deployment requires an active `agent-paste.link` Cloudflare zone, wildcard
  proxied DNS, Worker routes, and certificates before API output changes.
