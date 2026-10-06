# Project Status

Project start: 2026-05-18.

Last updated: 2026-10-06 for feedback capture and CLI 0.2.7 release preparation. Release and deployment evidence is recorded below.
The deployed one-URL architecture status below was recorded on 2026-09-03. See [changelog.md](./status/changelog.md) for older shipped
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
and show their newest HTML on refresh. Static assets reuse a private browser
cache for up to one hour, capped by signed expiry; a hard refresh revalidates
assets immediately.

The one-URL architecture is live: [Deploy Production run 33800556155](https://github.com/zaks-io/agent-paste/actions/runs/33800556155)
deployed commit [`c9f0b7c0`](https://github.com/zaks-io/agent-paste/commit/c9f0b7c0f6d14a737ad0eb34e16e47f6be0f7fb3)
after [CI run 33800305581](https://github.com/zaks-io/agent-paste/actions/runs/33800305581)
and [Security run 33800305564](https://github.com/zaks-io/agent-paste/actions/runs/33800305564)
passed for that same commit. Production readiness is commit-scoped: only call
a release ready when CI, Security, and Deploy Production all succeed for the
same head SHA. Independent latest runs are not proof.

On 2026-10-01, production deployed commit [`9b76e3e1`](https://github.com/zaks-io/agent-paste/commit/9b76e3e1a0de1418f33f932f3064467dfb1ce1ba):
[CI run 36937939352](https://github.com/zaks-io/agent-paste/actions/runs/36937939352),
[Security run 36937939392](https://github.com/zaks-io/agent-paste/actions/runs/36937939392),
and [Deploy Production run 36938087486](https://github.com/zaks-io/agent-paste/actions/runs/36938087486)
all succeeded for it on 2026-10-01.

The 2026-10-05 authentication documentation deployment ran
[Deploy Production 37268811823](https://github.com/zaks-io/agent-paste/actions/runs/37268811823)
for [`d361ac72`](https://github.com/zaks-io/agent-paste/commit/d361ac72f0f38d5da038eac1139f2cd3b7df8d74).
Current release evidence is tracked in [AP-455](https://linear.app/zaks-io/issue/AP-455/fixcli-align-api-key-authentication-and-public-docs).

The current production workflow requires successful CI for automatic deploys
and runs `pnpm verify` on manual dispatch. The full repository security
attestation runs separately on `main` and daily; it does not block production
deploys. CLI release still requires that attestation. A production deploy can
therefore succeed while `Security` fails; report those results separately.
See [security follow-ups](./security-todo.md#braces-depth-patch-ap-456) for the
AP-456 verified parser patch and local HTTP request boundary prepared to fix
the CLI release attestation blockers.

## CLI releases

The CLI package version is 0.2.7. Feedback capture delivery and publication
evidence is tracked in [AP-352](https://linear.app/zaks-io/issue/AP-352).
The prior 0.2.6 release evidence is tracked in [AP-455](https://linear.app/zaks-io/issue/AP-455/fixcli-align-api-key-authentication-and-public-docs).
See the [GitHub release](https://github.com/zaks-io/agent-paste/releases/tag/cli-v0.2.6)
and [npm package](https://www.npmjs.com/package/@zaks-io/agent-paste) for distribution status.

- **0.2.2:** `login --device-code` for sandboxes and remote shells. 0.2.1 was
  versioned in the repository but never published.
- **0.2.3:** accepts an Artifact URL or bare subdomain wherever it takes an
  artifact ID (AP-443). MCP tools accept the same references.
- **0.2.4:** smaller npm install.
- **0.2.5:** adds `download` to save a revision's zip bundle. Removes
  `--render-mode`, which now fails as an unknown flag, and the
  unknown-extension publish check it existed for. The unused `render_mode`
  database columns are dropped by a follow-up migration.

- **0.2.7:** adds authenticated `feedback` submission from a body argument or stdin.

- **0.2.6:** adds `authenticated: true` to successful `whoami` JSON
  and aligns API key authentication guidance across CLI help and public docs.

## CLI authentication

`AGENT_PASTE_API_KEY` authenticates CLI commands without an interactive login
and takes precedence over saved login credentials. Check `whoami --json` in
the inherited environment before starting a login. A rejected key fails rather
than falling back to saved login. See the
[CLI authentication contract](../specs/cli.md#authentication).

CLI 0.2.6 adds `authenticated: true` to successful `whoami` output and aligns
authentication guidance across public docs and agent instructions. CLI 0.2.5
omits the boolean on success; its Workspace, actor, and scopes still indicate
valid authentication.

CLI 0.2.2 adds `agent-paste login --device-code` for sandboxes and remote
shells. On 2026-09-13 it passed repository verification and a Linux install and
live browser-approval check through credential creation and authenticated
`whoami`. The test credential was revoked afterward.

The [CLI login contract](../specs/cli.md#login) explains prerequisites, process
handling, and what to do when authentication is unavailable.

## Current Product Shape

The shipped feature list is [`features.md`](../specs/features.md). This section
summarizes runtime boundaries only.

- **CLI:** `agent-paste publish <path>` is the primary agent workflow. It
  returns `artifact_id`, `revision_id`, `title`, `url`, and `expires_at`.
- **MCP:** eleven OAuth tools cover publish, revise, edit, list, read, delete, and
  display metadata, and feedback. Publish and revise return the same Artifact `url` contract.
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
