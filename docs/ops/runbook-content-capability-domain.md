# Content Capability Domain Runbook

This runbook activates production capability-scoped content origins at `https://{id}-uc.agent-paste.sh/{path}`. The `agent-paste.sh` zone and its Universal SSL certificate already exist; the certificate covers first-level `*.agent-paste.sh` hosts.

## Required Values

The checked-in production values are:

- Capability domain: `agent-paste.sh`
- Cloudflare zone: `agent-paste.sh`
- Worker Route: `*-uc.agent-paste.sh/*`

Preview intentionally keeps `CONTENT_CAPABILITY_DOMAIN` unset. Its natural hostname shape would be `{id}-uc.preview.agent-paste.sh`, which is not covered by the existing first-level wildcard certificate. Do not point production capability hosts at the preview Worker.

## Cloudflare Provisioning

1. Confirm `.github/workflows/deploy-production.yml` runs `scripts/ensure-content-capability-dns.mjs` before migrations and Worker deployment. The script idempotently creates a proxied wildcard `AAAA` DNS record named `*` in the `agent-paste.sh` zone with the placeholder target `100::`. It refuses to overwrite a conflicting wildcard. The target is never reached because the Worker Route intercepts the request, and existing explicit DNS records remain more specific than the wildcard.
2. Confirm the active edge certificate contains both `agent-paste.sh` and `*.agent-paste.sh`.
3. Confirm `apps/content/wrangler.jsonc` production contains:

   ```jsonc
   {
     "pattern": "*-uc.agent-paste.sh/*",
     "zone_name": "agent-paste.sh",
   }
   ```

4. Confirm production `api`, `content`, and `web` set `CONTENT_CAPABILITY_DOMAIN` to `agent-paste.sh` and preview leaves it unset.
5. Confirm the obsolete manifest lifecycle rule is absent. Durable capability
   manifests share one prefix, and pinned manifests must survive beyond 91 idle
   days:

   ```sh
   pnpm exec wrangler r2 bucket lifecycle list agent-paste-artifacts-production
   ```

   If `expire-content-capabilities` exists, remove it through the production
   change workflow before enabling durable capability URLs. Artifact lifecycle
   cleanup owns manifest deletion.

6. Run the pre-production checks below.
7. Deploy through the production workflow only after the wildcard DNS record
   exists and the conflicting manifest lifecycle rule is absent.

Cloudflare requires an active zone and a proxied DNS record before a Worker Route can receive the hostname. Custom Domains do not support wildcards, so do not replace the route with `custom_domain: true`.

## Pre-production Verification

- Run the API, content, web security-header, token, and repo-lint tests.
- Run `pnpm verify` and strict coverage.
- Run Wrangler production dry-runs for `apps/api` and `apps/content`.
- Confirm a random unassigned first-level hostname resolves only after the wildcard DNS record is intentionally created.

Preview continues to exercise legacy signed content URLs. The capability-host checks run locally with synthetic Host headers because Cloudflare cannot route the production `*-uc.agent-paste.sh/*` pattern to the preview Worker.

## Production Verification

- Publish a directory containing `index.html`, `/page2.html`, `/assets/app.js`, CSS `url(/fonts/site.woff2)`, and `import("/assets/chunk.js")`.
- Confirm the returned capability URL hostname matches `{32 lowercase hexadecimal characters}-uc.agent-paste.sh`.
- Confirm all file URLs share that origin and contain no `/v/` token.
- Open the capability URL top-level and follow the root-relative page link.
- Confirm inline and external HTTPS scripts execute, and the CSS, font, fetch,
  media, and module requests return successfully under the open artifact CSP.
- Revise the Artifact and confirm the same capability URL serves the new
  Revision.
- Pin the Artifact and confirm the same URL remains valid beyond its stored
  finite expiration. Unpin it and confirm that finite expiration is restored.
- Expire or delete the Artifact and confirm its capability returns the generic
  404 after retryable lifecycle cleanup removes the manifest.
- Confirm a legacy `/v/{token}/{path}` URL still works.
- Record the immutable deploy run, the capability hostname shape without the
  full bearer URL, the same-origin asset requests, the revise-in-place result,
  and the lifecycle cut-off result in AP-418.
