# Interim Production Security Baseline Before App Service

Status: Accepted.

The CLI-first MVP is live before the app service, Auth0-backed dashboard, and MCP surface exist. Until those surfaces are promoted, production's security boundary is intentionally narrow: `api`, `upload`, `content`, and the apex informational Worker are public; `web`, `mcp`, and `jobs` remain non-business-logic scaffolds. This ADR records the interim controls that must hold while that narrower production shape is live.

## Context

The first production deployment exposes enough public surface to need abuse and browser-boundary controls now:

- `api` verifies API Keys, serves public Agent View, and exposes repo-local admin REST routes.
- `upload` mints signed upload-worker PUT URLs and writes private R2 objects.
- `content` serves Untrusted Content from private R2 through signed content tokens.
- The app service is not yet available to provide Cloudflare Access/Auth0 operator identity, iframe sandboxing, or fragment-based Access Link resolution.

This means some broader platform ADRs are intentionally not executable yet, especially [ADR 0046](./0046-operator-identity-and-web-admin-surface.md), [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md), [ADR 0059](./0059-web-app-session-and-auth-forwarding-to-api.md), and [ADR 0060](./0060-cli-authentication-via-auth0-loopback.md). The interim baseline must be explicit so "not built yet" does not become silent security drift.

## Decision

- `content` is the only public origin that serves uploaded bytes. It must derive `Content-Type` only from the fixed extension allowlist, ignore upload-supplied R2 HTTP metadata, force unknown extensions to `application/octet-stream` with `Content-Disposition: attachment`, and apply the SVG-specific CSP override from [ADR 0042](./0042-strict-extension-based-served-content-type.md).
- `content` responses must carry the current MVP execution-policy headers: CSP, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy`, `Cross-Origin-Resource-Policy`, and `Cross-Origin-Opener-Policy`. Until the app viewer exists, `frame-ancestors 'none'` is the production default.
- Authenticated API-key traffic on `api` and `upload` must call the Cloudflare native rate-limit bindings when present. A missing binding is allowed only in local/unit tests, not in deployed Wrangler environments.
- Public Agent View accepts only signed Agent-View Tokens. There is no unsigned `{artifactId}.{revisionId}` fallback or escape hatch; the project is pre-launch, so no prior token generation needs back-compat.
- Public API JSON and public Agent View HTML responses are `Cache-Control: no-store`, because they can include freshly minted signed content URLs.
- Repo-local admin CLI commands that revoke credentials, delete artifacts, or run mutating cleanup require `--yes`.
- The single hashed admin bearer token remains an interim production operator path only for the CLI-first MVP. It is not the Phase 3 operator model. Before the app/admin surface is rolled out, production admin must move to the Cloudflare Access/Auth0 operator model in ADR 0046 or a superseding ADR must explicitly replace it.

## Consequences

- The MVP can keep serving direct public content URLs and public Agent View URLs before the app service exists, but uploaded metadata cannot upgrade a file into browser-executable content.
- The content origin is not embeddable by arbitrary sites during the interim period. The future app viewer must intentionally relax `frame-ancestors` to the approved app origins when it adds sandboxed embedding.
- Rate limiting is now fail-closed for configured bindings but still has the known ADR 0039 gap that idempotency replays are not yet resolved before the limiter in every route. Closing that ordering gap remains part of the runCommand/idempotency backlog.
- The hashed admin token is accepted as a short-lived MVP operating compromise, not as a general production admin design.

## Follow-Ups

- Promote [ADR 0046](./0046-operator-identity-and-web-admin-surface.md) before Phase 3 app/admin launch.
- Finish `runCommand`/idempotency wiring so idempotent replays do not consume rate-limit budget.
- Add artifact-level read throttling for the unauthenticated `content` path.
- Consolidate content signing secret names and then add staged key rotation tooling.
- Revisit direct content-token TTL once the app service can remint short-lived content URLs behind stable Access Links.
