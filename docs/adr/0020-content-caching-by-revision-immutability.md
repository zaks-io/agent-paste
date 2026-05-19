# Content Caching by Revision Immutability

The content gateway will cache aggressively only when URLs resolve to immutable Revision assets or derived Revision bundles. Stable Artifact URLs, Share Links, and Private Links resolve through current access state and latest published Revision, so they must not be hard-cached in a way that bypasses revocation, deletion, expiration, or latest-revision changes.

## Consequences

- Revision file URLs and Revision bundle URLs can use long-lived edge caching once published.
- Stable Artifact, Share Link, and Private Link resolution should check metadata before serving content.
- Share Link revocation, Expiration, and Artifact Deletion must stop access even if immutable underlying R2 objects remain.
- Cache keys should include Revision identity for immutable content.
