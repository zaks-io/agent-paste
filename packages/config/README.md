# config

Shared constants and path/expiry helpers.

Responsibilities:

- Local data directory and MVP size/TTL constants.
- Storage path normalization with traversal and length checks.
- Expiration helper shared by local and test flows.

This package should not hide global runtime state.
