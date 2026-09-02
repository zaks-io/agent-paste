# Content Capability Domain Runbook

This runbook activates Artifact capability origins on the separate
`agent-paste.link` registrable domain while preserving old links during migration.

## Required values

| Environment | Capability host                 | Signed-content base host               |
| ----------- | ------------------------------- | -------------------------------------- |
| Preview     | `{id}-preview.agent-paste.link` | `usercontent.preview.agent-paste.link` |
| Production  | `{id}.agent-paste.link`         | `usercontent.agent-paste.link`         |

The content Worker also keeps the matching `agent-paste.sh` wildcard routes during
migration. Old capability hosts redirect to the same path and query on `.link`.
Previously issued `usercontent.agent-paste.sh/v/...` URLs continue to resolve directly.

## Cloudflare provisioning

1. Add `agent-paste.link` to the same Cloudflare account and confirm the zone is `Active`.
2. Confirm `.github/workflows/deploy-production.yml` runs
   `scripts/ensure-content-capability-dns.mjs` before Worker deployment. The script
   idempotently creates a proxied wildcard `AAAA` record for `*.agent-paste.link` and
   refuses to overwrite a conflicting record.
3. Confirm the active edge certificate covers `agent-paste.link` and
   `*.agent-paste.link`.
4. Confirm `apps/content/wrangler.jsonc` has:

   ```jsonc
   // Production
   { "pattern": "usercontent.agent-paste.link", "custom_domain": true },
   { "pattern": "*.agent-paste.link/*", "zone_name": "agent-paste.link" },
   { "pattern": "*.agent-paste.sh/*", "zone_name": "agent-paste.sh" },
   ```

   Preview uses `usercontent.preview.agent-paste.link`,
   `*-preview.agent-paste.link/*`, and matching legacy `.sh` routes for both
   capability hosts and `usercontent.preview.agent-paste.sh/*`.

5. Confirm API, upload, and content Worker `CONTENT_BASE_URL` values use `.link`.
   Confirm API and content `CONTENT_CAPABILITY_DOMAIN` values use `.link`.
6. Confirm the old broad capability-manifest lifecycle rule remains absent:

   ```sh
   pnpm exec wrangler r2 bucket lifecycle list agent-paste-artifacts-production
   ```

7. Run the checks below. Deploy through the normal preview workflow first. Production
   deployment still requires explicit approval.

Cloudflare Worker routes require an active zone and proxied DNS. Custom Domains do not
provide wildcard capability hosting, so the wildcard stays a Worker Route.

## Local and dry-run verification

- Run `pnpm verify`.
- Run Wrangler dry-runs for API, upload, content, and apex in both preview and production.
- Confirm the config linter accepts exactly one current and one legacy wildcard route per
  environment.
- Confirm the DNS helper targets the `agent-paste.link` zone and refuses conflicts.

## Hosted verification

- Publish a claimed directory with HTML, local JavaScript, CSS, a font, fetch, media, and a
  Web Worker. Confirm it runs on the `.link` capability host without CSP errors.
- Publish the same directory through the ephemeral flow. Confirm static content renders,
  while scripts, fetch, forms, frames, objects, and workers remain blocked.
- Request an uploaded JavaScript path with `Service-Worker: script`. Confirm the response is
  the platform retirement worker with `Cache-Control: no-store` and `Clear-Site-Data`, not
  uploaded bytes.
- Open an old `.agent-paste.sh` capability URL and confirm a `308` to the exact `.link` host,
  path, and query.
- Open a previously issued signed `usercontent.agent-paste.sh/v/...` URL and confirm it still
  serves until its token expires.
- Revise the Artifact and confirm its `.link` capability URL serves the new Revision.
- Delete the Artifact and confirm public content is denied before the API reports success.
- Verify `https://agent-paste.com/<path>?<query>` and the `www` alias redirect to the exact
  canonical `https://agent-paste.sh` path and query.

Record deployment IDs and redacted host shapes. Never paste a full capability URL or signed
content URL into logs or tickets.
