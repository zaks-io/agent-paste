# Signed Token Codec and the `packages/tokens` Module

Status: Accepted.

The HMAC-signed bearer tokens that `api`, `upload`, and `content` mint and verify are unified
behind one `@agent-paste/tokens` package. A single codec owns the `base64url(payload).hmac` wire
scheme; per-kind modules own each payload shape. The three Workers and `packages/auth` stop
carrying their own copies of the crypto primitives. This refines
[ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md), which remains the
canonical content-gateway authorization model: this ADR changes where the token code lives and
closes three latent correctness gaps, not the authorization model.

## Context

Five copies of the same token crypto exist today:

- `apps/api`, `apps/upload`, and `apps/content` each reimplement `hmac`, `base64UrlEncode`,
  `base64UrlDecode`, and `constantTimeEqual`.
- `packages/auth` carries a fourth copy (`hmacBase64Url`, `base64UrlEncode`, `constantTimeEqual`).

They diverge in ways that are latent bugs, not stylistic differences:

- `packages/auth`'s `constantTimeEqual` short-circuits when the two strings differ in length
  (`if (left.length !== right.length) return false`), so it is not constant-time across
  length-varying input. The three Workers' copies pad to a max length and never short-circuit.
  Same function name, two behaviors.
- `packages/auth`'s `base64UrlEncode` is `btoa(String.fromCharCode(...bytes))`. The spread passes
  every byte as a separate argument; a large enough input throws
  `RangeError: too many function arguments`. The Worker copies encode without the spread.
- `apps/upload`'s `verifyPayload` calls `JSON.parse` on the decoded payload without a try/catch,
  so a malformed token throws instead of failing closed.
- `apps/api`'s `verifySignedPayload` checks the signature but not the payload shape or expiration
  at the same call site; expiration is checked separately by the caller. `apps/content`'s
  `verifyContentToken` checks signature, shape, and expiration together. Two verify disciplines
  for one wire format.

Three token kinds ride the same wire scheme, with three secrets and three payload shapes:

- the **Content-Gateway Token** (`CONTENT_SIGNING_SECRET`, minted by `api` and `upload`, verified
  by `content`),
- the **Agent-View Token** (verified by `api`),
- the upload PUT signed-URL token (`UPLOAD_SIGNING_SECRET`, `{ sid, path, key, size, exp }`
  carried in a `?token=` query, minted and verified by `upload`).

## Decision

- New package `@agent-paste/tokens` with sub-path exports:
  - `./crypto`: `hmac`, `base64UrlEncode`, `base64UrlDecode`, and one `constantTimeEqual` that
    never short-circuits on length. This is the only module `packages/auth` imports;
    `packages/auth` deletes its own three copies.
  - `.`, `./content`, `./agent-view`, `./upload-url`: one module per token kind. Each exports a
    `mint*` / `verify*` pair, and the URL-bearing kinds add a fused `mint*Url` that signs the
    token and builds the URL in one call.
  - internal `codec.ts`: `sign(payload, secret)` and
    `verify(token, secret, { isValid, now? })`. `verify` decodes, recomputes and compares the
    signature with the non-short-circuiting `constantTimeEqual`, runs the caller's `isValid`
    shape guard, checks `exp` against the clock, and returns the typed payload or `null`. It
    never throws.
  - internal `clock.ts`: a `Clock` seam (`now(): number`) defaulting to `Date.now`, injectable in
    tests. This is the one substitutable seam in the package.
- Public `verify*` functions return `Payload | null`. Callers branch on `null`; no caller catches
  an exception from verification.
- Worker-local concerns stay in the Workers, out of the package: the dev/legacy unsigned-token
  bypass, the unsigned-URL fallback, environment-variable precedence and secret names, and the
  TTL policy that decides each token's `exp`. The package takes `exp` as an input; it does not
  read usage policy.

### Reconciliations

1. One `constantTimeEqual`, never short-circuiting on length. This removes the `auth`
   short-circuit; it is a constant-time-correctness fix, not a behavior change any correct caller
   depended on.
2. `verify` enforces signature, shape, and expiration together and never throws. This fixes
   `upload`'s throwing `verifyPayload` and aligns `api`'s signature-only verify with `content`'s
   stricter discipline.
3. Token expiration is an explicit `exp` per caller. `api` derived it from
   `usagePolicy.default_ttl_seconds`; `upload` hardcoded `30 * 24 * 60 * 60`. These are the same
   value today, so this is not a live bug; the package requires the caller to pass `exp`, keeping
   the TTL source of truth in the caller.

## Consequences

- The five crypto copies collapse to one. A change to the wire scheme or the constant-time
  compare is written once.
- The interface is the test surface: `verify` is exercised directly with a fake `Clock` for
  expiry and with tampered tokens for the signature and shape paths, instead of each Worker
  testing its own copy through an HTTP handler.
- `@agent-paste/tokens` has no Hono or Worker dependency; it is pure crypto plus typed payloads,
  runnable in a plain unit test.

## What this ADR does not change

- [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md) remains the canonical
  content-gateway authorization model: short-lived tokens, `content` verifies signature, expiry,
  and shape and checks the KV denylist with no database. Only the code's location and the verify
  discipline change.
- [ADR 0045](./0045-secret-rotation-cadence-and-on-demand-tooling.md) key rotation / `kid` stays parked and
  out of scope. The codec signs and verifies with a single secret per token kind, as today.
- The denylist key derivation and R2 serving in `content`, and the URL shape and secret-name
  choices in each Worker, stay in the Workers.

## Follow-Ups

- When ADR 0045 rotation lands, the codec gains a `kid`-indexed verify; the single-secret path
  becomes the degenerate case.
- Implementation is tracked in [`docs/ops/signed-tokens-todo.md`](../ops/signed-tokens-todo.md).
