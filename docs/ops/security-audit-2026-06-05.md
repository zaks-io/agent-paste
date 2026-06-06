# Security Audit 2026-06-05

Pre-public hardening notes from the 2026-06-05 security audit. These are
defense-in-depth findings for latent footguns rather than known exploitable
production issues.

Implementation: AP-252 on 2026-06-06. Related rate-limit fail-closed hardening:
AP-236. Focused coverage was added for registrar rate-limit IP selection, byte
purge prefix scoping, content bundle and file key validation, and app
return-path filtering.

## L1: X-Forwarded-For Rate-Limit Fallback

`packages/worker-runtime/src/registrar-request.ts` must trust only
`CF-Connecting-IP` for the ephemeral provision per-IP rate-limit key, and
`packages/worker-runtime/src/rate-limit.ts` must fail closed when the Cloudflare
edge header is absent instead of falling back to attacker-controlled
`X-Forwarded-For` or a shared `unknown` bucket.

Tracked in AP-252.

## L2: Byte-Purge Prefix Scope

`apps/jobs/src/handlers/byte-purge.ts` must assert every requested purge prefix
starts with `artifacts/{artifact_id}/` before listing or deleting from R2.

Tracked in AP-252.

## L3: Bundle Key Prefix Equality

`apps/content/src/serve-object.ts` must require bundle content tokens to carry a
`workspace_id`, re-derive the expected bundle key from workspace, artifact,
revision, and storage environment, and require signed `key_prefix` equality
before reading R2.

Tracked in AP-252.

## L4: Content Path And Key-Prefix Validation

`apps/content/src/serve-object.ts` must reject unsafe read paths containing
backslashes, empty segments, `.`, or `..`, and must validate signed
`key_prefix` on read. The load-bearing assumption is that R2 object keys are
opaque strings, not filesystem paths.

Tracked in AP-252.

## L5: App Return-Path Open Redirect Filter

`apps/web/src/lib/auth-return-path.ts` must reject raw backslashes and
protocol-relative forms. Only same-origin absolute paths are accepted.

Tracked in AP-252.
