# Signed Content URLs from `api` to `content` with `kid` Rotation

Status: Superseded by [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md) and [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md). Do not implement this ADR directly.

## Supersession Note

This ADR captured an intermediate private-read design where `content` validated short-lived URLs and consulted Postgres for deletion and retention state. The final model keeps `content` free of Hyperdrive and centralizes row-level state checks in `api`: authenticated private reads and Access Link reads both resolve through `api`, which mints short-lived content-gateway tokens per [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md). **Access Links** themselves use the fragment-encoded signed URL model in [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md).

The historical text below is retained only to explain why cross-origin cookies and long-lived bearer tokens were rejected.

## Historical Decision

The superseded design minted private-read URLs shaped like `https://content.agent-paste.sh/v1/private/<artifact_id>/<revision_id>/<path>?exp=<unix_seconds>&kid=<key_id>&sig=<base64url>` and had `content` consult Postgres before serving bytes. That gave immediate deletion and retention checks, but it also gave `content` a Hyperdrive binding and created a second content-token family beside the general content gateway. The accepted model in ADR 0028 keeps one content-token family and keeps row-level state checks in `api`.
