# storage

Artifact storage and content response helper package.

Responsibilities:

- Served content type mapping from a fixed extension allowlist.
- Default `application/octet-stream` fallback for unknown extensions.
- Shared response security headers for untrusted content serving.
- Artifact-byte AES-256-GCM encryption, decryption, metadata, and key-ring reads.
- Workspace blob object-key parsing, reads, writes, and claim-time reparenting.
- Strict UTF-8 decoding and unified-diff application for revisions.

Runtime signing and URL helpers live in `@agent-paste/tokens`. Encryption keys
are supplied by Worker bindings; this package does not own or persist them.
