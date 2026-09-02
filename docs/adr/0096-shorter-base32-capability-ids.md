# Shorter Base32 Capability IDs

Status: Accepted and implemented. Amends [ADR 0093](./0093-capability-scoped-content-origins.md) and [ADR 0094](./0094-capability-url-is-the-artifact-link.md).

## Decision

New Capability IDs contain 20 lowercase Crockford-base32 symbols from
`0123456789abcdefghjkmnpqrstvwxyz`. The first 19 symbols are random and carry
95 bits of entropy. The final symbol is a check symbol. Four groups of five
symbols produce the 23-character `xxxxx-xxxxx-xxxxx-xxxxx` hostname label.

Each random symbol is selected as `alphabet[randomByte & 31]` from exactly 19
random bytes. The check symbol is the sum of each random symbol value multiplied
by alternating weights 1 and 3, starting with 1, modulo 32. Validation requires
the exact grouped shape and a valid check symbol.

Legacy 32-character lowercase hexadecimal Capability IDs remain valid on every
surface. Existing IDs are never migrated or rewritten.

## Rationale

The 32-character hexadecimal label was a usability tax in chat and terminals.
The threat model is online guessing of a bearer hostname through a permissive
per-edge rate limit, so entropy carries the load. With 95 random bits, one
million live Artifacts, and 100,000 requests per second for one year, the chance
of a hit is approximately 2^-33. The OWASP session identifier floor is 64 bits.

Hostname labels are LDH and case-folded. Lowercase Crockford base32 without
`i`, `l`, `o`, or `u` is the readable alphabet for that environment. Hyphen
grouping costs zero entropy. The check symbol deliberately carries zero entropy;
it exists so the edge can reject single-symbol errors and truncation before an
R2 read.

## Consequences

- New Artifact URLs are shorter and easier to read, select, and transcribe.
- The edge validates the check symbol before looking up the Capability Manifest.
- Shape-only contracts and database constraints accept both encodings without
  depending on the token package.
- Legacy published URLs remain permanent.
