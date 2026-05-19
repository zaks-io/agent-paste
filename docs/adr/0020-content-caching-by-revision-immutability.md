# Content Caching by Revision Immutability

The content gateway will cache aggressively only after access control resolves to immutable Revision assets or derived Revision bundles. Stable Artifact URLs, Access Links, and Private Links resolve through current access state, revocation state, and published Revision metadata, so they must not be hard-cached in a way that bypasses revocation, deletion, expiration, or latest-revision changes.

## Consequences

- Revision file responses and Revision bundle responses can use long-lived edge caching once access has been checked.
- Stable Artifact, Access Link, and Private Link resolution should check metadata before serving content.
- Access Link revocation, Access Link Lockdown, Expiration, Retention, and Artifact Deletion must stop access even if immutable underlying R2 objects remain.
- Cache keys should include Revision identity for immutable content.
