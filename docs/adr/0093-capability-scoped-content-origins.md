# Capability-Scoped Content Origins on a Dedicated Zone

Status: Accepted. Supersedes [ADR 0014](./0014-single-domain-with-hardened-content-subdomain.md) for new content URLs and amends [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md).

Published directories use one unguessable hostname per resolved viewer capability:

```text
https://{32-lowercase-hex-id}.{dedicated-content-zone}/{path}
```

The 16 random ID bytes provide 128 bits of entropy. The hostname identifies one resolved authorization capability, not one Revision. `api` stores a small R2 manifest at `content-capabilities/v1/{id}.json` before returning the URL. The manifest contains the entrypoint and the existing signed content token, including workspace, Artifact, Revision, Access Link when present, expiry, execution policy, noindex policy, and the allowed path-to-object-key map. `content` loads that manifest and feeds the signed token through the existing signature, expiration, denylist, decryption, rate-limit, CSP, and response-hardening path.

## Considered Options

- **Keep `/v/{token}/{path}` and rewrite root-relative content.** HTML attribute rewriting does not cover CSS `url(...)`, JavaScript module imports, or application-generated paths. It also keeps the full Revision path map in every request URL.
- **Use one hostname per Revision.** This breaks selective Access Link revocation because two viewer grants for the same Revision would share a hostname.
- **Store manifests in KV.** Publish-then-open can observe stale state because KV is eventually consistent. R2 provides globally strong read-after-write consistency: <https://developers.cloudflare.com/r2/reference/consistency/>.
- **Put the signed token itself in the hostname.** DNS labels are limited to 63 characters, while the current 100-file token is much larger.
- **Capability-scoped R2 manifest and dedicated zone (chosen).** One short stable origin solves root-relative paths and URL bloat while retaining the existing authorization proof and selective denylist keys.

## Consequences

- Root-relative HTML, CSS, JavaScript, fonts, images, and module imports stay within the capability origin without content rewriting.
- A 100-file path map is stored once in private R2. Browser request URLs contain only the fixed 32-character capability ID and requested path.
- Access Link revocation remains selective because `access_link_id` is inside the capability's signed token. Artifact, Revision, and Workspace denylist checks are unchanged.
- The `api` Worker uses its existing bucket binding to write only the `content-capabilities/v1/` prefix. The binding is bucket-scoped because R2 bindings do not enforce prefix permissions. `content` remains read-only and still has no database binding.
- Capability manifests age out through an R2 lifecycle rule scoped to `content-capabilities/v1/`. The rule expires objects after 91 days, one day beyond the platform's 90-day maximum Artifact TTL. Cloudflare lifecycle rules support prefix filters: <https://developers.cloudflare.com/r2/buckets/object-lifecycles/>.
- Existing `/v/{token}/{path}` and `/b/{token}` URLs remain valid through their normal expiry. Bundles keep the signed `/b` route.
- New capability issuance is enabled only when both Workers have the same `CONTENT_CAPABILITY_DOMAIN`. An invalid domain or missing R2 write binding fails loudly.
- The content zone is a separate registrable domain, outside the `.agent-paste.sh` site boundary. User-content requests therefore cannot receive parent-domain cookies.
- Custom Domains cannot match wildcard hostnames. The dedicated zone uses a proxied wildcard DNS record plus a Worker Route matching `*.{zone}/*`: <https://developers.cloudflare.com/workers/configuration/routing/custom-domains/>, <https://developers.cloudflare.com/workers/configuration/routing/routes/>.
- The capability ID becomes visible to DNS resolvers, TLS SNI observers when ECH is unavailable, and browser history. It remains an unguessable bearer locator, but the path-token design exposed it to fewer network observers. This is the accepted secrecy trade-off for complete directory-hosting semantics.
- The iframe sandbox remains `allow-scripts allow-popups` without `allow-same-origin`. Cookies and service workers remain unavailable to artifacts.

## Rollout State

The code path is domain-agnostic and preserves legacy URLs when `CONTENT_CAPABILITY_DOMAIN` is absent. Preview and production remain on legacy issuance until the dedicated registrable zone is selected, added to Cloudflare, and configured using [`runbook-content-capability-domain.md`](../ops/runbook-content-capability-domain.md).
