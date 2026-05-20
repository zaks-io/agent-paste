# Agent View Envelope Shape

The **Agent View** response wraps the **Manifest** from [ADR 0053](./0053-manifest-shape-and-creator-visibility.md) with five sibling fields: `display_metadata`, `files`, `content_prefix`, `safety_warnings`, and `bundle`. Files reference paths under a single signed `content_prefix` from [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md) — one token per resolved **Revision**, not a per-file URL map. **Safety Warnings** carry a stable snake_case `code` (the contract), a `severity` of `info` or `warning`, a `scope` of `artifact`, `revision`, or `file`, an optional `file_path`, a sanitized plain-text `message`, and `detected_at`. **Bundle Availability** follows [ADR 0050](./0050-bundle-availability-and-asymmetric-dlq-consumption.md): a single object with `status`; `url`, `size_bytes`, and `generated_at` only when ready; optional `retry_after_seconds` when pending; and no public error detail when failed.

## Considered Options

- **Per-file URL map for content.** Each file gets its own fully signed content-gateway URL. O(N) signatures per resolve, larger payload, and clients still construct nothing. Rejected because [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md) already pins `usercontent.agent-paste.sh/v/{token}/{path}` with one token spanning the **Revision**, so the prefix model is strictly cheaper and matches HTML subresource resolution for free.
- **Embed files inside the Manifest.** Mixes platform-controlled identity with mutable bytes-level data. Rejected per [ADR 0053](./0053-manifest-shape-and-creator-visibility.md): the file listing is a sibling of the **Manifest**, not part of it.
- **Safety Warnings as message-only strings.** Easier to ship. Removes any stable contract for callers that branch on warning type. Rejected; `code` is the durable identifier per the snake_case error-code convention from [ADR 0036](./0036-error-envelope-and-generic-404-boundary.md) and [ADR 0039](./0039-authenticated-rate-limits-under-usage-policy.md).
- **Bundle status string only.** Matches the CLI README's first cut. Forces a follow-up call to retrieve the ready **Bundle** URL and size. Rejected because the envelope is already an aggregate; returning the URL inline when ready is one fewer round trip and matches the prefix-on-resolve pattern.

## Consequences

- `content_prefix` is regenerated on every resolve and inherits the content-gateway token TTL from [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md). Consumers that fail a fetch should re-resolve.
- `served_content_type` is included on every file entry. It is derived from the extension allowlist in [ADR 0042](./0042-strict-extension-based-served-content-type.md), not from the agent-supplied upload value. Including it spares clients from replicating the allowlist.
- `sha256` is required on every file entry, computed at **Upload Session** finalize and stored alongside the R2 object. Clients can dedupe and verify integrity locally without a re-fetch.
- File `path` values are normalized at finalize: forward-slash POSIX, no leading slash, no `..`, NFC Unicode. Out-of-band paths fail finalize.
- **Safety Warning** `severity` is `info | warning` only; there is no `error` severity. Errors are validation/policy failures that block **Publish**, per CONTEXT.md's "**Safety Warnings** do not block **Publish**."
- **Bundle** `url` is short-lived and shaped `usercontent.agent-paste.sh/b/{token}` per [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md). It is omitted until **Bundle Availability** transitions to `ready`.
- Failed **Bundle Availability** does not expose an `error_code`; operators consult operational logs for failure detail.
- Adding fields to any sibling is non-breaking; removing or retyping is breaking and requires a versioned API change per [ADR 0023](./0023-versioned-public-rest-apis.md).
