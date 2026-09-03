# config

Shared runtime limits, Plan policy, and path/expiry helpers.

Responsibilities:

- Local data directory and MVP size/TTL constants.
- Free and Pro usage-policy caps and billing-enabled resolution.
- Ephemeral, free, and Pro daily write-allowance tiers.
- Storage path normalization with traversal and length checks.
- Expiration helper shared by local and test flows.

This package should not hide global runtime state.
