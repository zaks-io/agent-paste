# Architecture

## Runtime boundaries

| Runtime   | Owns                                                                                   | Does not own                                   |
| --------- | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `apex`    | Public site and documentation.                                                         | Artifact bytes or account state.               |
| `web`     | Authenticated management console and session handling.                                 | Recipient rendering or durable product writes. |
| `api`     | Publish orchestration, metadata, authorization, capability manifests, management APIs. | Serving Artifact bytes.                        |
| `upload`  | Resumable upload ingress into private R2.                                              | Public Artifact URLs.                          |
| `content` | Capability-host resolution, token verification, byte decryption, content headers.      | User sessions or metadata mutation.            |
| `jobs`    | Asynchronous lifecycle and cleanup work.                                               | Interactive request handling.                  |

`stream` remains deployable only for migration history. No shipped route or
publish flow calls it.

## Publish flow

1. A client uploads files and finalizes a Revision through `api` and `upload`.
2. `api` commits the Revision and writes the latest capability manifest to R2.
3. The manifest binds a random 128-bit capability ID to a signed exact-Revision
   content token and entrypoint.
4. `api` returns the capability origin as `url`.
5. The browser opens that origin directly. `content` resolves the hostname,
   loads the manifest, verifies the signed token, and serves decrypted bytes.

Production hosts are `{capabilityId}.agent-paste.sh`. Preview hosts are
`{capabilityId}-preview.agent-paste.sh`. The capability ID is exactly 32
lowercase hexadecimal characters. It is the bearer secret, so logs retain only
redacted host metadata.

## Routing

The content Worker owns wildcard routes `*.agent-paste.sh/*` in production and
`*-preview.agent-paste.sh/*` in preview. Because a Cloudflare Route runs before
a matching Custom Domain, the production Worker forwards the explicit product
host allowlist and the bounded `pr-{positive integer}.preview.agent-paste.sh`
web-preview shape to those Custom Domain origins. It rejects every other
wildcard hostname that does not exactly match the environment's
capability-host grammar.

## Rendering and CSP

Artifacts are websites, not documents embedded by the management app. The
capability response uses the compatibility-oriented policy in
[`content-rendering.md`](./content-rendering.md), always denies framing, and
does not inject viewer scripts or wrappers.

Previously issued signed content URLs remain an expiration-only compatibility
path. New publishes cannot fall back to that path in preview or production.

## Storage and authority

Postgres owns Workspace, Artifact, Revision, credential, billing, audit, and
lifecycle metadata. R2 owns encrypted Artifact bytes and capability manifests.
KV and Durable Objects are not authority for which Revision a capability host
serves. A publish is successful only after its durable metadata and manifest
write succeed.

See [ADR 0094](../adr/0094-capability-url-is-the-artifact-link.md) for the
decision and migration boundary.
