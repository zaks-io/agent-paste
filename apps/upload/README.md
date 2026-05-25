# upload

Upload-session Cloudflare Worker.

Responsibilities:

- Create Upload Sessions.
- Issue signed upload-worker PUT URLs.
- Refresh signed upload-worker PUT URLs.
- Write uploaded bytes to private R2 object keys.
- Finalize sessions by verifying R2 objects.
- Create finalized MVP artifact state through `runCommand`.

Contracts: [`docs/specs/api.md`](../../docs/specs/api.md) and [`packages/contracts/src/uploadSessions.ts`](../../packages/contracts/src/uploadSessions.ts).
