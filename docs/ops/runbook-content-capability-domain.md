# Content Capability Domain Runbook

This runbook activates capability-scoped content origins after a dedicated registrable domain has been selected and added as an active Cloudflare zone. Do not use a child of `agent-paste.sh`; the separate site boundary is part of ADR 0093.

## Required Values

Record these non-secret values in the implementation change:

- Preview capability domain, normally the dedicated zone itself.
- Production capability domain, normally the dedicated zone itself.
- Cloudflare zone name.

The runtime value is a lowercase hostname without a scheme, port, or `*`, for example `content-example.test`. Each content URL adds exactly one capability label beneath it.

## Cloudflare Provisioning

1. Add a proxied wildcard `AAAA` DNS record named `*` with the placeholder target `100::`. The target is never reached because the Worker Route intercepts the request.
2. Wait until the zone's Universal SSL certificate covers both the apex and `*.{zone}`.
3. Add this route to `apps/content/wrangler.jsonc` in each activated environment:

   ```jsonc
   {
     "pattern": "*.example-content-zone.test/*",
     "zone_name": "example-content-zone.test",
   }
   ```

4. Set `CONTENT_CAPABILITY_DOMAIN` to `example-content-zone.test` in the matching `apps/api` and `apps/content` environment vars.
5. Add the manifest lifecycle rule to each environment bucket, preserving all existing lifecycle rules:

   ```sh
   pnpm exec wrangler r2 bucket lifecycle add agent-paste-artifacts-preview \
     expire-content-capabilities content-capabilities/v1/ --expire-days 91

   pnpm exec wrangler r2 bucket lifecycle add agent-paste-artifacts-production \
     expire-content-capabilities content-capabilities/v1/ --expire-days 91
   ```

6. Deploy preview first. Do not activate production until preview DNS, TLS, routing, and browser checks pass.

Cloudflare requires an active zone and a proxied DNS record before a Worker Route can receive the hostname. Custom Domains do not support wildcards, so do not replace the route with `custom_domain: true`.

## Preview Verification

- Publish a directory containing `index.html`, `/page2.html`, `/assets/app.js`, CSS `url(/fonts/site.woff2)`, and `import("/assets/chunk.js")`.
- Confirm the returned `revision_content_url` hostname begins with exactly 32 lowercase hexadecimal characters.
- Confirm all file URLs share that origin and contain no `/v/` token.
- Open the Artifact Viewer and follow the root-relative page link.
- Confirm the script, CSS, font, and module requests all return 200 from the same origin.
- Revoke the Access Link and confirm its capability returns the generic 404 while a separately minted link for the same Revision still works.
- Confirm a copied top-level capability URL remains inert and non-frameable.
- Confirm a legacy `/v/{token}/{path}` URL still works.

## Production Verification

Run the same fixture after the production workflow completes. Record the immutable deploy run, the capability hostname shape without the full bearer URL, the successful same-origin asset requests, and the selective revocation result in AP-418.
