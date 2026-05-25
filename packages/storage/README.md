# storage

Content response helper package.

Responsibilities:

- Served content type mapping from a fixed extension allowlist.
- Default `application/octet-stream` fallback for unknown extensions.
- Shared response security headers for untrusted content serving.

Runtime signing and URL helpers live in `@agent-paste/tokens`; this package has no secret material.
