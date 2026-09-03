# Project Status

Project start: 2026-05-18.

Last updated: 2026-09-03 for public repository readiness and the deployed
one-URL architecture. See [changelog.md](./status/changelog.md) for older shipped
work.

This is the status entrypoint after `AGENTS.md`. Current behavior is specified
in [`docs/specs/`](../specs/README.md); ADRs and the older ledgers record why the
system reached that behavior.

## Current Release

The current release removes the app-hosted viewer and makes every successful
publish return one top-level Artifact URL:

```text
Production: https://{capability-id}.agent-paste.link/
Preview:    https://{capability-id}-preview.agent-paste.link/
```

The Content Worker serves the Artifact directly on that host. The app does not
proxy, wrap, redirect, or iframe uploaded content. Revisions keep the same URL
and show their newest published bytes on refresh.

The one-URL architecture is live: [Deploy Production run 33797883931](https://github.com/zaks-io/agent-paste/actions/runs/33797883931)
deployed commit [`4d655b07`](https://github.com/zaks-io/agent-paste/commit/4d655b078289468e79151ddf53c8216509b4a8ac)
after [CI passed](https://github.com/zaks-io/agent-paste/actions/runs/33797671593).
Its separate [Security run](https://github.com/zaks-io/agent-paste/actions/runs/33797671580)
reported the dependency advisories corrected by the 2026-09-03 repository
cleanup. Production readiness is commit-scoped: only call a release ready when
CI, Security, and Deploy Production all succeed for the same head SHA.
Independent latest runs are not proof.

## Current Product Shape

- **CLI:** `agent-paste publish <path>` is the primary agent workflow. It
  returns `artifact_id`, `revision_id`, `title`, `url`, and `expires_at`.
- **MCP:** ten OAuth tools cover publish, revise, edit, list, read, delete, and
  display metadata. Publish and revise return the same Artifact `url` contract.
- **Content:** untrusted files run top-level on a unique `agent-paste.link`
  capability subdomain, separate from product and authentication origins.
  Claimed content permits normal uploaded-site behavior. Ephemeral content uses
  a signed restricted policy with scripts, connections, workers, and forms
  disabled. Service workers are unsupported on every tier.
- **Dashboard:** manages the Workspace and opens Artifact URLs directly. It has
  no content viewer, iframe, Access Link viewer, or Live Update proxy.
- **API:** owns authenticated control-plane operations and capability-manifest
  writes. It does not expose public viewer or Access Link routes.
- **Ephemeral publish:** returns the same top-level `url` plus claim fields for
  optional ownership promotion.
- **Storage:** Artifact bytes remain private in R2 and are selected through the
  signed durable capability manifest.

Historical Access Link tables, codecs, migrations, and the Stream Worker remain
as dormant migration history. They are not current publish or viewing surfaces.
Do not build new behavior on them without a new spec and consumer.

## Verification

The repository gate is:

```sh
pnpm verify
```

Hosted completion additionally requires:

1. Deploy the branch to preview through the normal workflow.
2. Publish `examples/csp-proof` through the authenticated preview API.
3. Confirm its `.agent-paste.link` URL loads top-level and Tailwind, inline
   script, and eval proof execute without a CSP console error.
4. Publish the same proof through the ephemeral path and confirm its scripts,
   fetch, form submission, frames, objects, base URL changes, and workers stay
   blocked while static content renders.
5. Confirm both responses include `frame-ancestors 'none'` and
   `X-Frame-Options: DENY`.
6. Request an uploaded JavaScript path with `Service-Worker: script` and confirm
   the response is the platform retirement worker, never uploaded bytes.

Production deployment is handled by the GitHub `Deploy Production` workflow
and is never run without explicit approval.

## Ledgers

- [Phase backlog](./status/phase-backlog.md): historical phase ordering and
  remaining non-architecture work.
- [Implementation state](./status/implementation.md): detailed package history.
- [Coverage ledger](./status/coverage.md): spec and ADR coverage.
- [Hosted ops](./status/hosted-ops.md): environments, secrets, and deploy order.
- [Changelog](./status/changelog.md): completed work, newest first.
- [CLI release runbook](./runbook-cli-release.md): npm and standalone release.
- [Ephemeral publish runbook](./runbook-ephemeral-publish.md): claim and abuse
  operations. Its old URL terminology must not override the current specs.

When an older ledger describes an app viewer, iframe, Access Link, Share Link,
Private Link, visibility command, or Live Update viewer as current, treat it as
historical. The current contracts are the specs linked above.
