# upload

Planned upload-session Cloudflare Worker.

Responsibilities:

- Create Upload Sessions.
- Issue signed PUT URLs.
- Refresh signed PUT URLs.
- Finalize sessions by verifying R2 objects.
- Create Draft Revisions through `runCommand`.

Contracts: [`docs/specs/api.md`](../../docs/specs/api.md) and [`packages/contracts/src/uploadSessions.ts`](../../packages/contracts/src/uploadSessions.ts).
