# Signed Token Codec (`packages/tokens`) — implementation todo

Tracks [ADR 0071](../adr/0071-signed-token-codec-and-tokens-package.md). Goal: one
`@agent-paste/tokens` package owns the `base64url(payload).hmac` codec and the three token-kind
modules; `packages/auth` and the three Workers import it and delete their crypto copies.

Do these in order. Each Worker cutover is behavior-preserving except the three reconciliations in
the ADR.

## Steps

- [x] **Scaffold the package.** `packages/tokens/package.json` (`@agent-paste/tokens`, sub-path
      exports `.`, `./crypto`, `./content`, `./agent-view`, `./upload-url`), `tsconfig.json` extending
      `../../tsconfig.base.json`, matching the `packages/auth` layout.
  - Done: `pnpm --filter @agent-paste/tokens typecheck` runs on an empty `src`.
- [x] **`crypto.ts`.** `hmac`, `base64UrlEncode` (no `String.fromCharCode` spread),
      `base64UrlDecode`, and one `constantTimeEqual` that pads to a max length and never
      short-circuits.
  - Done: unit tests cover equal, unequal-same-length, and unequal-different-length inputs, and a
    large-input `base64UrlEncode` that would have thrown under the spread.
- [x] **`clock.ts`.** `Clock` interface (`now(): number`) with a `systemClock` default.
- [x] **`codec.ts` (internal).** `sign(payload, secret)` and
      `verify(token, secret, { isValid, now? })` returning `Payload | null`, never throwing. Decodes,
      compares signature with `constantTimeEqual`, runs `isValid`, checks `exp` against the clock.
  - Done: tests cover valid round-trip, tampered signature, malformed base64, failed `isValid`,
    and expired `exp` with a fake clock.
- [x] **`content.ts`.** `ContentTokenPayload` type, `isValidContentTokenPayload`,
      `mintContentToken`, `verifyContentToken`, and fused `mintContentUrl`. Payload shape copied
      verbatim from the current `apps/content` superset.
- [x] **`agent-view.ts`.** Agent-View payload type, guard, `mintAgentViewToken`,
      `verifyAgentViewToken`, fused `mintAgentViewUrl`.
- [x] **`upload-url.ts`.** `SignedUploadPayload = { sid, path, key, size, exp }`,
      `mintUploadUrl` (token in `?token=` query), `verifyUploadToken`.
- [x] **`index.ts`.** Re-export the public surface.
  - Done: `pnpm --filter @agent-paste/tokens check` (typecheck + tests) green.
- [x] **Cut over `packages/auth`.** Import `./crypto`; `hashAdminToken` now calls `hmac` directly,
      and auth's `base64UrlEncode` and short-circuiting `constantTimeEqual` are gone. Also deleted
      auth's test-only api-key trio (`generateApiKey` / `parseApiKey` / `verifyApiKeySecret`) and its
      Crockford/random helpers — dead code; `packages/db` owns the live api-key path. Public `auth`
      cache + request-id surface unchanged.
  - Done: `pnpm --filter @agent-paste/auth check` green; no `String.fromCharCode(...` left in
    `packages/auth`.
- [x] **Fold in `packages/db`** (scope expansion beyond ADR 0071, decided 2026-05-24). ADR 0071
      undercounted: `db/api-keys.ts` and `db/id.ts` held two more crypto copies. `api-keys.ts` now
      imports `hmac` + `constantTimeEqual` from `./crypto`; `id.ts` re-exports `base64UrlEncode` from
      `./crypto` and keeps only `randomCrockford` / `createId`. `db` is the canonical, live api-key
      home (wired through `repository/shared.ts` + `repository/core.ts`).
  - Done: ported api-key test (`packages/db/src/api-keys.test.ts`) covers generate→verify, tampered
    key, wrong pepper, and production + legacy bearer parse; `pnpm --filter @agent-paste/db check` green.
- [x] **Cut over `apps/content`.** Replaced `verifyContentToken`, `isValidContentTokenPayload`,
      `hmac`, `constantTimeEqual` with `@agent-paste/tokens/content` (`signContentToken` kept as a
      re-export alias of `mintContentToken` for existing call sites). Kept `denylistKeysForPayload`,
      `objectKeyFor`, and the R2 serve in `content`.
  - Done: content Worker tests green; verify still rejects tampered, malformed, and expired tokens.
- [x] **Cut over `apps/api`.** Replaced `signContentToken`, `signedContentUrl`,
      `verifySignedPayload`, and the Agent-View mint/verify with the package; passes explicit `exp` from
      `usagePolicy.default_ttl_seconds`. Deleted api's `hmac` / `base64Url*` / `constantTimeEqual`
      (the admin-token compare now uses the imported `constantTimeEqual`).
  - Done: api Worker tests green; api verifies shape + expiry (not signature only).
- [x] **Cut over `apps/upload`.** Replaced `signUploadUrl`, `verifyUploadToken`, `signedContentUrl`,
      `signedAgentViewUrl`, `signPayload`, `verifyPayload` with the package (`mintUploadUrl`,
      `mintContentUrl`, `mintAgentViewUrl`, and `verifyUploadToken`); passes explicit `exp`. Deleted
      upload's crypto copies. `verifyPayload`'s throw path is gone (codec returns `null`).
  - Done: upload Worker tests green; a malformed upload token returns the not-found/invalid
    envelope, not a 500.

## Done (overall) — complete 2026-05-24

- `@agent-paste/tokens` is the only place HMAC token crypto lives. No `hmac` /
  `base64UrlEncode` / `base64UrlDecode` / `constantTimeEqual` copy remains in `packages/auth`,
  `packages/db`, `apps/api`, `apps/upload`, or `apps/content` (grep clean). The only remaining
  copies are the standalone deploy scripts `scripts/bootstrap-secrets.mjs` and
  `scripts/deploy-pr-preview.mjs` (`hmacBase64Url`), kept on purpose as the rotation-runbook impl
  reference — they run outside the workspace and do not import `@agent-paste/*`.
- The three reconciliations from ADR 0071 are in place: non-short-circuiting `constantTimeEqual`,
  non-throwing `verify`, explicit per-caller `exp`.
- `pnpm verify` green across all 66 Turbo tasks; `pnpm smoke:local` green (publish + content fetch +
  Agent View chain unchanged).
