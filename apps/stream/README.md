# stream

Live Updates worker for ADR 0069. Holds one `ArtifactLiveUpdates` Durable Object per artifact, fans out published-revision pointers over SSE, and authorizes every connection by forwarding credentials to `api` over a service binding.

## Routes

- `GET /healthz`
- `POST /v1/live/access-links/{publicId}` — public Share Link viewers (body carries the signed blob; never the URL)
- `GET /v1/live/artifacts/{artifactId}` — dashboard viewers (`Authorization: Bearer` WorkOS session)

## Local dev

With `pnpm dev:all`, the harness serves stream on `http://127.0.0.1:8791` and shares an in-memory Durable Object namespace with `api`.

```bash
pnpm --filter @agent-paste/stream test
pnpm --filter @agent-paste/stream typecheck
```
