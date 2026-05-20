# upload

Planned upload-session Cloudflare Worker.

Responsibilities:

- Create Upload Sessions.
- Issue signed upload-worker PUT URLs.
- Refresh signed upload-worker PUT URLs.
- Encrypt uploaded bytes before writing to R2.
- Finalize sessions by verifying R2 objects.
- Create Draft Revisions through `runCommand`.

Contracts: [`docs/specs/api.md`](../../docs/specs/api.md) and [`packages/contracts/src/uploadSessions.ts`](../../packages/contracts/src/uploadSessions.ts).
