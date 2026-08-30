# Acceptance

## Publish

An authenticated or ephemeral publish is accepted when all of these are true:

- The upload creates or revises one Artifact.
- The publish API result is exactly `artifact_id`, `revision_id`, `title`,
  `url`, and `expires_at`. The `--ephemeral` CLI wrapper adds provisioning and
  optional claim fields around that same publish result.
- `url` is immediately usable without login.
- Production uses `https://{32-lowercase-hex}.agent-paste.sh/`.
- Preview uses `https://{32-lowercase-hex}-preview.agent-paste.sh/`.
- A later publish to the same Artifact keeps the hostname and advances the
  content shown after refresh.
- Claiming an ephemeral Artifact keeps the same URL and immediately refreshes
  its manifest with the destination Workspace, copied object keys, and claimed
  retention deadline.
- HTML opens top-level. No dashboard viewer, iframe, redirect, or visibility
  command is required.
- Inline scripts, `eval`, Tailwind's browser CDN, external HTTPS dependencies,
  data and blob assets, workers, fetch, and secure WebSockets are allowed.
- The response denies framing with `frame-ancestors 'none'` and
  `X-Frame-Options: DENY`.
- A missing capability domain, signing secret, manifest write binding, or URL is
  a publish failure outside local development.

## Clients

CLI, MCP, REST, and the API client expose the same common publish fields. The
ephemeral CLI wrapper additionally returns `claim_url` and the provisioning
identifiers needed for optional ownership. Removed Access Link, visibility,
private-viewer, and live-viewer commands are not registered or documented.

## Compatibility

Previously issued signed `usercontent.agent-paste.sh/v/...` URLs may resolve
until their embedded expiration. They never gain the stable capability-host
contract and cannot be minted by the current publish surface.

## Verification

The release gate includes unit and contract tests, OpenAPI goldens, hosted
publish smoke, capability-host routing checks, CSP checks, and a browser run
that proves inline JavaScript executes without a CSP console error.
