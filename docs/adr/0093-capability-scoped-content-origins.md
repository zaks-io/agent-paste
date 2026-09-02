# Capability-Scoped Content Origins on agent-paste.sh

Status: Accepted and amended by [ADR 0094](./0094-capability-url-is-the-artifact-link.md), [ADR 0095](./0095-isolate-active-content-and-restore-ephemeral-execution-policy.md), and [ADR 0096](./0096-shorter-base32-capability-ids.md). Its original hostname suffix, shared registrable-domain, and new-ID encoding decisions are historical.

The remainder of this ADR records the original decision and rollout state. Its
`.agent-paste.sh` hostnames, iframe assumptions, and inactive-rollout statements
are superseded. Use the current specifications, ADR 0094, and ADR 0095 for the
implemented behavior.

Published directories use one unguessable hostname per resolved viewer capability:

```text
https://{32-lowercase-hex-id}-uc.agent-paste.sh/{path}
```

The 16 random ID bytes provide 128 bits of entropy. The hostname identifies one resolved authorization capability, not one Revision. `api` stores a small R2 manifest at `content-capabilities/v1/{id}.json` before returning the URL. The manifest contains the entrypoint and the existing signed content token, including workspace, Artifact, Revision, Access Link when present, expiry, execution policy, noindex policy, and the allowed path-to-object-key map. `content` loads that manifest and feeds the signed token through the existing signature, expiration, denylist, decryption, rate-limit, CSP, and response-hardening path.

## Considered Options

- **Keep `/v/{token}/{path}` and rewrite root-relative content.** HTML attribute rewriting does not cover CSS `url(...)`, JavaScript module imports, or application-generated paths. It also keeps the full Revision path map in every request URL.
- **Use one hostname per Revision.** This breaks selective Access Link revocation because two viewer grants for the same Revision would share a hostname.
- **Store manifests in KV.** Publish-then-open can observe stale state because KV is eventually consistent. R2 provides globally strong read-after-write consistency: <https://developers.cloudflare.com/r2/reference/consistency/>.
- **Put the signed token itself in the hostname.** DNS labels are limited to 63 characters, while the current 100-file token is much larger.
- **Use a separate registrable content domain.** This creates a stronger browser site boundary, but the existing `usercontent.agent-paste.sh` origin is already same-site with the app. The host-only authentication cookie, sandbox without `allow-same-origin`, and direct-navigation CSP are the controls that protect the current system. A new domain adds certificate, preview, DNS, and operating overhead without being required to solve directory hosting.
- **Capability-scoped R2 manifest on `agent-paste.sh` (chosen).** One short stable origin solves root-relative paths and URL bloat while retaining the existing authorization proof, selective denylist keys, and current shared-site security posture.

## Consequences

- Root-relative HTML, CSS, JavaScript, fonts, images, and module imports stay within the capability origin without content rewriting.
- A 100-file path map is stored once in private R2. Browser request URLs contain only the fixed 32-character capability ID and requested path.
- Access Link revocation remains selective because `access_link_id` is inside the capability's signed token. Artifact, Revision, and Workspace denylist checks are unchanged.
- The `api` Worker uses its existing bucket binding to write only the `content-capabilities/v1/` prefix. The binding is bucket-scoped because R2 bindings do not enforce prefix permissions. `content` remains read-only and still has no database binding.
- Capability manifests age out through an R2 lifecycle rule scoped to `content-capabilities/v1/`. The rule expires objects after 91 days, one day beyond the platform's 90-day maximum Artifact TTL. Cloudflare lifecycle rules support prefix filters: <https://developers.cloudflare.com/r2/buckets/object-lifecycles/>.
- Existing `/v/{token}/{path}` and `/b/{token}` URLs remain valid through their normal expiry. Bundles keep the signed `/b` route.
- New capability issuance is enabled only when `api` and `content` have the same `CONTENT_CAPABILITY_DOMAIN`. An invalid domain or missing R2 write binding fails loudly.
- Production sets `CONTENT_CAPABILITY_DOMAIN=agent-paste.sh` in `api`, `content`, and `web`. The existing Universal SSL certificate covers `*.agent-paste.sh`, so capability hosts remain first-level subdomains without an additional certificate product: <https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/>.
- Custom Domains cannot match wildcard hostnames. Production uses a proxied wildcard DNS record plus a content Worker Route matching `*-uc.agent-paste.sh/*`. Cloudflare route wildcards may appear at the beginning of the pattern and match zero or more characters. The `-uc` suffix keeps the route away from product Custom Domains such as `app.agent-paste.sh` and `api.agent-paste.sh`; the content Worker accepts only a 32-character lowercase hexadecimal id before that suffix: <https://developers.cloudflare.com/workers/configuration/routing/custom-domains/>, <https://developers.cloudflare.com/workers/configuration/routing/routes/>.
- The app CSP allows `https://*.agent-paste.sh` in `frame-src` because CSP host-source grammar permits a wildcard only as the complete leftmost label, not as a partial `*-uc` label: <https://www.w3.org/TR/CSP3/#grammardef-host-part>. Capability URLs remain bounded by their unguessable id, the iframe sandbox, the content response's `frame-ancestors`, and the content Worker's strict hostname parser.
- Capability hosts remain separate browser origins even though they share the `agent-paste.sh` site. The host-only `__agp_session` authentication cookie is never sent to them. The parent-scoped `agp_theme` and `agp_analytics` preference cookies may be sent, but artifacts cannot read cookies: viewer documents have an opaque sandbox origin, and copied top-level documents receive `script-src 'none'` and `form-action 'none'`. A separate registrable domain would remain a defense-in-depth improvement, not a requirement or a regression from the existing content origin.
- The capability ID becomes visible to DNS resolvers, TLS SNI observers when ECH is unavailable, and browser history. It remains an unguessable bearer locator, but the path-token design exposed it to fewer network observers. This is the accepted secrecy trade-off for complete directory-hosting semantics.
- The iframe sandbox remains `allow-scripts allow-popups` without `allow-same-origin`. Cookies and service workers remain unavailable to artifacts.

## Rollout State

The code path is domain-agnostic and preserves legacy URLs when `CONTENT_CAPABILITY_DOMAIN` is absent. Production configuration is checked in for `agent-paste.sh` but remains inactive until the wildcard DNS record, R2 lifecycle rule, and production deployment are completed using [`runbook-content-capability-domain.md`](../ops/runbook-content-capability-domain.md).

Preview deliberately stays on legacy issuance. `{id}-uc.preview.agent-paste.sh` is a second-level subdomain not covered by the existing Universal SSL certificate, and the production suffix route cannot simultaneously target the preview Worker. Unit, integration, local host-routing, and Wrangler dry-run checks are the pre-production gate; the first hosted capability-origin smoke is part of the explicitly approved production activation.
