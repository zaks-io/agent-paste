# CLI-First MVP Spec

Implementation progress is tracked in [`docs/ops/project-status.md`](../ops/project-status.md). This file remains the product/contract target; the project status doc records what is implemented, verified, blocked, or intentionally deferred across all phases.

This file is the original CLI-first MVP baseline. The shipped hosted service has
since added the later dashboard, Access Link, lifecycle, billing, ephemeral
publish, and MCP phases listed in [`features.md`](./features.md) and
[`docs/ops/project-status.md`](../ops/project-status.md).
Current product use cases are centralized in [`use-cases.md`](./use-cases.md).

agent-paste is a hosted artifact handoff service for agents. The MVP proves one loop:

```sh
AGENT_PASTE_API_KEY=ap_pk_... agent-paste publish ./site
```

The command uploads a single HTML file or an HTML folder, returns stable URLs for a human and another agent, and expires the artifact later so the service does not accumulate cruft forever.

## Product Promise

An agent should be able to publish a generated HTML work product with one command and hand off a durable URL. A human can open the result in a browser. Another agent can fetch a small JSON manifest with full per-file URLs. The hosted service treats uploaded bytes as untrusted and deletes expired artifacts automatically.

The MVP is intentionally smaller than the original platform plan:

- Hosted from day one on Cloudflare.
- Public product surface is the `agent-paste` CLI.
- Public CLI auth is API-key only.
- OAuth, dashboard, MCP, Access Link lifecycle, Bundles, multi-Revision
  Artifacts, billing, and app-layer encryption were later phases and are no
  longer absent from the shipped service.
- Retention is part of the MVP.

## Actors

**API Key Publisher**:
An agent, CI job, script, or developer using `AGENT_PASTE_API_KEY`. This is the only public publishing actor in the MVP.

**Unauthenticated Recipient**:
A human or agent with a signed URL returned by publish. This actor can view only the artifact/revision encoded in the signed URL and only until the artifact expires or is deleted.

**Operator**:
A human with the WorkOS `admin` role or automation using Cloudflare Access service tokens for platform lockdown and rotation endpoints. Hosted MVP verification provisions workspaces through the non-production smoke harness (or a pre-provisioned smoke API key). Member self-service via `agent-paste login` and `/v1/web/*` is Phase 3, not MVP acceptance.

## Surfaces

**Public CLI**:
The public product surface. MVP commands are:

```sh
agent-paste publish <path> [--title "..."]
agent-paste whoami
```

**API Worker**:
Owns API-key auth, artifact metadata, public Agent View, web/operator routes, and operation events.

**Upload Worker**:
Owns upload sessions, signed upload-worker PUT URLs, upload size/count validation, digest reuse decisions, and R2 writes.

**Content Worker**:
Serves untrusted artifact bytes from private R2 through signed content URLs. It has R2 read access and KV denylist read access. It has no Hyperdrive binding.

## MVP Artifact Shape

The primary use case is generated HTML:

- A single `.html` file, including self-contained "mono HTML" files.
- A folder with `index.html` and static assets referenced by the HTML/CSS.

Secondary support is allowed only when cheap:

- `.txt` and `.md` files may be accepted as downloadable files.
- Markdown/text renderer pages are not required for the first implementation slice.

Out of MVP:

- Directory browsing.
- PDF/audio/video preview.
- Bundle generation/download.
- User-chosen render modes beyond HTML entrypoint inference.

## Publish Result

Every successful publish creates a new **Artifact** with one **Revision**. MVP does not update existing artifacts.

Publish returns:

```json
{
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "title": "demo",
  "private_url": "https://app.agent-paste.sh/v/art_...",
  "revision_content_url": "https://usercontent.agent-paste.sh/v/{content_token}/index.html",
  "agent_view_url": "https://api.agent-paste.sh/v1/public/agent-view/{agent_view_token}",
  "expires_at": "2026-06-19T12:00:00.000Z"
}
```

Authenticated publish is content-only and private. `private_url` is the
login-walled clean viewer at `/v/<artifactId>` for the owning Workspace Member
and is the default authenticated handoff link publish returns; there is no
`share` input and no `shared` output. Creating an unlisted no-login handoff is
the separate MCP `set_visibility` / CLI
`agent-paste set-visibility <artifact-id> unlisted` step, which currently mints
or reuses the one Share Link and returns `unlisted_url`. Accountless
`--ephemeral` publish is the exception: it auto-creates that Share Link and
returns `unlisted_url` immediately.
`revision_content_url`
remains a direct signed content URL for the exact Revision. Direct `usercontent`
HTML is inert raw byte delivery unless it is loaded through the controlled
Artifact Viewer iframe. The content token lives in the path.

`agent_view_url` is public and signed. It returns a JSON manifest for the same
Revision. A `private_url` is login-walled app navigation, so a plain HTTP client
may receive an app shell or sign-in redirect state with HTTP 200. That status
code does not make the Artifact publicly readable.

## Agent View

MVP Agent View is simple JSON with full URLs. It does not use `content_prefix`.

```json
{
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "title": "demo",
  "created_at": "2026-05-20T12:00:00.000Z",
  "expires_at": "2026-06-19T12:00:00.000Z",
  "entrypoint": "index.html",
  "revision_content_url": "https://usercontent.agent-paste.sh/v/{content_token}/index.html",
  "files": [
    {
      "path": "index.html",
      "size_bytes": 12345,
      "content_type": "text/html; charset=utf-8",
      "url": "https://usercontent.agent-paste.sh/v/{content_token}/index.html"
    }
  ]
}
```

## Upload Flow

1. CLI walks the file or folder, normalizes POSIX paths, infers the title when `--title` is omitted, and validates local caps.
2. CLI calls `POST upload /v1/upload-sessions` with file paths, sizes, title,
   entrypoint, and an idempotency key.
3. `upload` validates the API key, enforces caps, reserves `artifact_id` and `revision_id`, stores the session, and returns signed upload-worker PUT URLs.
4. CLI PUTs each file to the signed upload URLs.
5. CLI calls `POST upload /v1/upload-sessions/{session_id}/finalize`.
6. `upload` verifies all expected files, records file metadata, creates the artifact/revision through the API worker boundary, signs the content and Agent View URLs, and returns the publish result.

No client receives an R2 URL. The upload URLs are upload-worker URLs only.

## Auth

Public CLI auth is API-key only:

```sh
AGENT_PASTE_API_KEY=ap_pk_... agent-paste publish ./site
```

`agent-paste login` (WorkOS loopback PKCE, [ADR 0060](../adr/0060-cli-authentication-via-auth0-loopback.md)) and member routes under `/v1/web/*` shipped after this MVP baseline. They mint or manage credentials through the web API; headless callers can still use `AGENT_PASTE_API_KEY`.

Operator auth uses WorkOS `admin` role claims and Cloudflare Access on the web operator surface. See [admin operations](./admin.md).

## Retention

Retention is required in the MVP and is selected by server-side Workspace policy.
Current policy values are subject to Workspace/Plan configuration.

- Default lifetime: `30d`.
- Minimum lifetime: `1d`.
- Maximum lifetime: `90d`.
- Every artifact has `expires_at`.
- Every upload session has `expires_at`.
- Expired artifacts stop resolving and their R2 bytes are deleted by cleanup.
- Expired upload sessions delete partial legacy revision-key R2 bytes. Workspace shared blob keys are not prefix-purged from session cleanup; jobs-owned blob GC removes unreferenced blob index rows. v1 leaves the deterministic R2 object bytes in place rather than racing concurrent first uploads that reuse the same key.
- No forever retention in MVP.
- No pinning in MVP.

Cleanup runs in the `jobs` Worker cron discovery path; non-production smokes trigger it through the jobs harness (`POST /__test__/run-cleanup`).

## Caps And Limits

Initial MVP caps:

- Max file size: `10 MB`.
- Max artifact size: `25 MB`.
- Max files per artifact: `100`.
- API-key actor rate limit target: `60 requests/minute`.

These are platform caps, not user-configurable settings.

## Content Safety

Uploaded HTML is untrusted content:

- It is served only from `usercontent.agent-paste.sh`.
- R2 is private.
- Direct R2 URLs are never exposed.
- Content type is derived from normalized file extension.
- Inline scripts and styles are allowed for generated HTML prototypes.
- Network egress is restricted by CSP.
- Tokens and full signed URLs must not be logged.

Application-layer artifact-byte encryption is active. Legacy revision objects and bundles use AAD bound to Artifact/Revision/path; workspace shared blobs use digest-bound AAD so one verified blob can be referenced by multiple active revisions in the same workspace.

## Operation Events

The MVP records lightweight operation events, designed to grow into a fuller audit log later.

Required events:

- Workspace created.
- API key created or revoked.
- Upload session created, finalized, expired, or failed.
- Artifact published, deleted, or expired.
- Cleanup run.
- Admin destructive operation.

Secrets, content tokens, signed URLs, and API-key secret material are never stored in event details.

## Out Of Initial MVP

Many items below have since shipped in later phases. Use
[`features.md`](./features.md) and [`docs/ops/project-status.md`](../ops/project-status.md)
for the current state.

- Dashboard and admin UI.
- `agent-paste login` and member `/v1/web/*` dashboard APIs (Phase 3; see [phases](./phases.md)).
- Public OAuth login.
- Self-serve signup.
- MCP server.
- Multi-member workspaces.
- Multi-revision artifacts and updates.
- Latest-moving share links.
- Fragment-based Access Link Signed URLs.
- Link revoke/mint/lockdown lifecycle.
- Bundle generation and download.
- File-bytes hash-reputation malware scanner integration.
- App-layer encryption and key rotation.
- Billing, quotas, and plans.
- Public TypeScript SDK.
- Standalone binary distribution.

## MVP Acceptance Shape

The MVP is buildable when the API-key publish loop works end to end. Phase 3 member login and `/v1/web/*` are tracked separately in [phases](./phases.md).

- The non-production smoke harness (or a pre-provisioned production smoke API key) can provision a workspace and one-time API key for hosted verification.
- `agent-paste whoami` works with `AGENT_PASTE_API_KEY`.
- `agent-paste publish ./site` uploads a folder with `index.html`.
- `agent-paste publish ./demo.html` uploads a single HTML file.
- Authenticated human-facing publish output returns the `private_url` (`/v/<artifactId>` clean viewer) as `View`.
- JSON/REST publish output also carries `artifact_id`, `revision_id`, `private_url`, `revision_content_url`, `agent_view_url`, and `expires_at` for automation. There is no `share` input and no `shared` output. Ephemeral publish also carries `unlisted_url` and claim fields.
- `private_url` is the authenticated `/v/<artifactId>` clean viewer; authenticated unlisted no-login sharing is the separate `set-visibility unlisted` step, which currently mints or reuses the one Share Link and returns `unlisted_url`; ephemeral publish auto-creates that Share Link; `revision_content_url` is raw byte delivery for one Revision; and `agent_view_url` returns JSON with full per-file URLs.
- Expired artifacts stop resolving and their bytes are cleaned up.
