# content

Isolated untrusted-content Cloudflare Worker.

Responsibilities:

- Verify signed content-gateway tokens.
- Read denylist state from KV.
- Read private R2 objects.
- Apply extension-derived content types rather than trusting upload-supplied MIME.
- Apply execution-policy, CSP, SVG strict-CSP, cache, and security headers.
- Enforce artifact-level read throttling through Cloudflare rate-limit bindings.

Contracts: [`docs/specs/content-rendering.md`](../../docs/specs/content-rendering.md).
