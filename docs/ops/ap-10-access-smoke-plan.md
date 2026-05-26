# AP-10: Production Operator Access Smoke Plan

Issue: AP-10. Verify that production operator paths are protected by Cloudflare
Access at the edge and by app-side operator auth inside `api`.

Scope: smoke only. Do not redesign operator auth, do not retire `ADMIN_TOKEN`,
and do not run production commands without explicit Isaac approval and hosted
credentials.

## Preconditions

- Explicit approval to run production smoke commands.
- A production WorkOS user whose active session carries the `admin` role slug.
- Cloudflare Access service-token credentials for the production operator app:
  `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`.
- A disposable API key for negative testing, if available.
- Do not print cookies, bearer tokens, service-token values, or
  `Cf-Access-Jwt-Assertion` contents in logs or Linear.

## Paths Under Test

- Web operator route: `https://app.agent-paste.sh/admin`
- API operator route: `https://api.agent-paste.sh/v1/web/admin/lockdowns`

The API implementation accepts a WorkOS operator access token or a Cloudflare
Access service-token JWT with a valid `common_name`. Unauthorized app-side
failures must collapse to the generic `not_found` envelope when they reach the
Worker.

## Smoke Matrix

| Case                              | Command shape                                                                                                                                                      | Expected result                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Web, no Access identity           | `curl -si https://app.agent-paste.sh/admin`                                                                                                                        | Cloudflare Access challenge/deny, never the app admin page.                                                     |
| API, no Access identity           | `curl -si https://api.agent-paste.sh/v1/web/admin/lockdowns`                                                                                                       | Cloudflare Access challenge/deny or generic app `not_found`, never `200` data.                                  |
| API, API-key only                 | `curl -si -H "Authorization: Bearer $DISPOSABLE_API_KEY" https://api.agent-paste.sh/v1/web/admin/lockdowns`                                                        | Cloudflare Access challenge/deny or generic app `not_found`, never `200` data.                                  |
| Web, approved human operator      | Open `https://app.agent-paste.sh/admin` in the approved browser session.                                                                                           | Access passes, WorkOS operator guard passes, page renders lockdown list/empty state.                            |
| API, valid Access service token   | `curl -si -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" https://api.agent-paste.sh/v1/web/admin/lockdowns` | `200` JSON with `items` and `page_info`. This proves Access injected a JWT that app-side verification accepted. |
| API, invalid Access service token | Same command with a deliberately wrong secret.                                                                                                                     | Access challenge/deny, never `200`.                                                                             |
| API, spoofed assertion            | Request with a fake `Cf-Access-Jwt-Assertion` and no valid service token.                                                                                          | Access challenge/deny or generic app `not_found`, never `200`.                                                  |

## Evidence To Record

- Date/time and environment: production only.
- Redacted command shape.
- HTTP status, response content type, and request ID if present.
- For JSON responses, only the schema shape and item count. Do not paste token
  values, cookies, full headers, or secret-bearing URLs.
- Whether the failure was edge-gated by Cloudflare Access or app-gated by the
  generic `not_found` envelope.

## Current Evidence

2026-05-26 production curlable smoke:

- Web `/admin`, no identity: `302` to Cloudflare Access, no Worker request.
- API `/v1/web/admin/lockdowns`, no identity: `302` to Cloudflare Access, no
  Worker request.
- API with disposable API key only: `302` to Cloudflare Access, no Worker
  request.
- API with invalid Access service token: `302` to Cloudflare Access, no Worker
  request.
- API with valid Access service token: `200` JSON with `items` and `page_info`
  after `CF_ACCESS_AUD` was uploaded to `agent-paste-api-production`.
- Web `/admin` with valid Access service token: Access passes, then the web app
  redirects to WorkOS sign-in (`307`), expected without a browser WorkOS session.
- Web `/admin` with approved human operator browser session: Access passes,
  WorkOS `admin` role guard passes, and the admin lockdown page renders.

## Status Updates After Passing

- Done: `docs/ops/status/phase-backlog.md` marks the Cloudflare Access
  app-side follow-up complete.
- Done: `docs/ops/status/hosted-ops.md` records the smoke date and outcomes.
- Done: `docs/ops/status/coverage.md` keeps ADR 0046 partial only for the
  legacy `ADMIN_TOKEN` migration/retirement work.
- Done: `docs/ops/status/changelog.md` records the smoke result.
- Done: AP-12 is unblocked for route-by-route execution.

## Verification Boundary

Run only the approved smoke commands for this issue. `pnpm verify` is useful for
any code/doc patch, but AP-10 acceptance is production smoke evidence, not a
local unit-test result.
