# @agent-paste/auth-md

The auth.md agent-registration skill document, and the protocol URNs it names, as one
source shared by every origin that has to serve them.

## Why it exists

`/auth.md` is a conventional path: agents and discovery scanners probe it at the
service root (`agent-paste.sh/auth.md`) as well as following `agent_auth.skill` from
the Authorization Server Metadata (`api.agent-paste.sh/auth.md`). Two origins have to
answer, and a Cloudflare Custom Domain claims a whole hostname, so the API Worker
cannot serve the apex path on the marketing worker's behalf. Before this package, that
meant either a 404 on one origin or two copies of a protocol document that would drift.

## What's here

- `renderAuthMd({ issuer })` - the document. A pure function of the authorization
  server origin, so both origins render byte-identical text. The first line is an H1
  containing the literal `auth.md`, which is how scanners confirm the response is an
  auth.md skill rather than an unrelated page.
- `AUTH_MD_PATH`, `AUTH_MD_CONTENT_TYPE` - the path and `text/markdown; charset=utf-8`.
- The protocol URNs (`AGENT_AUTH_ID_JAG_ASSERTION_TYPE`,
  `AGENT_AUTH_JWT_BEARER_GRANT_TYPE`, `AGENT_AUTH_CLAIM_GRANT_TYPE`,
  `AGENT_AUTH_REVOKED_EVENT`). They live with the document that documents them;
  `@agent-paste/contracts` re-exports them so schema consumers are unaffected.

## Live capability stays in the metadata

The document deliberately does not state which registration types a deployment has
enabled. That is `agent_auth.identity_types_supported` in the Authorization Server
Metadata, which only the API Worker can compute (it depends on
`AGENT_AUTH_TRUSTED_PROVIDERS_JSON`). Restating it here would have forced the marketing
worker to guess. The document points at the metadata instead.

## Vocabulary is pinned to the upstream spec

Field names track [workos/auth.md](https://github.com/workos/auth.md). The v0.1.0 names
`register_uri` and `claim_uri` became `identity_endpoint` and `claim_endpoint` in spec
v0.2.0; `revocation_uri` became `events_endpoint` in v0.3.0; the `verified_email`
assertion type was removed in v0.6.0 in favor of a top-level `service_auth`
registration type, which Agent Paste does not accept. A test asserts none of the
retired names come back.
