# Acceptance

## Publish

An authenticated or ephemeral publish is accepted when all of these are true:

- The upload creates or revises one Artifact.
- The publish API result is exactly `artifact_id`, `revision_id`, `title`,
  `url`, and `expires_at`. The `--ephemeral` CLI wrapper adds provisioning and
  optional claim fields around that same publish result.
- `url` is immediately usable without login.
- Production uses
  `https://{four-groups-of-five-lowercase-base32-symbols}.agent-paste.link/`.
- Preview uses
  `https://{four-groups-of-five-lowercase-base32-symbols}-preview.agent-paste.link/`.
- A later publish to the same Artifact keeps the hostname and advances the
  content shown after refresh.
- Claiming an ephemeral Artifact keeps the same URL and immediately refreshes
  its manifest with the destination Workspace, copied object keys, and claimed
  retention deadline.
- HTML opens top-level. No dashboard viewer, iframe, redirect, or visibility
  command is required.
- Claimed Artifacts allow inline scripts, `eval`, Tailwind's browser CDN,
  external HTTPS dependencies, data and blob assets, dedicated Web Workers,
  fetch, and secure WebSockets.
- Ephemeral Artifacts block scripts, connections, workers, forms, frames,
  objects, and base-URL changes while retaining static styles, images, fonts,
  and media.
- Service-worker script requests never serve uploaded bytes on any tier.
- The response denies framing with `frame-ancestors 'none'` and
  `X-Frame-Options: DENY`.
- A missing capability domain, signing secret, manifest write binding, or URL is
  a publish failure outside local development.

## Clients

CLI, MCP, REST, and the API client expose the same common publish fields. The
ephemeral CLI wrapper additionally returns `claim_url` and the provisioning
identifiers needed for optional ownership. Removed Access Link, visibility,
private-viewer, and live-viewer commands are not registered or presented as
current client behavior.

## Compatibility

Previously issued signed `usercontent.agent-paste.sh/v/...` URLs may resolve
until their embedded expiration. They never gain the stable capability-host
contract and cannot be minted by the current publish surface.

Legacy 32-character hexadecimal capability IDs remain readable. Newly minted
IDs use four groups of five lowercase base32 symbols; the final symbol is a
check symbol.

## Verification

The release gate includes unit and contract tests, OpenAPI goldens, hosted
publish smoke, capability-host routing checks, both tier CSPs, a browser run
that proves claimed inline JavaScript executes, and an ephemeral browser run
that proves uploaded scripts and forms cannot execute or submit.
