# stream

Dormant Live Updates migration history from ADR 0069. No current API, web, CLI,
or MCP path consumes this Worker. Keep the retained code and tests intact for
migration compatibility, but do not treat it as a current product surface.

## Historical routes

- `GET /healthz`
- `POST /v1/live/access-links/{publicId}` — public Share Link viewers (body carries the signed blob; never the URL)
- `GET /v1/live/artifacts/{artifactId}` — dashboard viewers (`Authorization: Bearer` WorkOS session)

## Migration harness

`pnpm dev:all` still serves stream on `http://127.0.0.1:8791` and shares an
in-memory Durable Object namespace with `api` so the retained migration code
can be exercised.

```bash
pnpm --filter @agent-paste/stream test
pnpm --filter @agent-paste/stream typecheck
```
