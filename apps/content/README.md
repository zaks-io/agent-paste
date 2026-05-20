# content

Planned isolated untrusted-content Cloudflare Worker.

Responsibilities:

- Verify content-gateway tokens.
- Read denylist state from KV.
- Serve R2 files and bundles.
- Serve renderer pages for non-HTML Render Modes.
- Apply extension-derived content types and execution policy headers.

Contracts: [`docs/specs/content-rendering.md`](../../docs/specs/content-rendering.md).
