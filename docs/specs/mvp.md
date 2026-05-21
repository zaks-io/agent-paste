# CLI-First MVP Spec

Implementation progress is tracked in [`docs/ops/mvp-bootstrap-checklist.md`](../ops/mvp-bootstrap-checklist.md). This file remains the product/contract target; the ops checklist records what is implemented, verified, blocked, or intentionally deferred.

agent-paste is a hosted artifact handoff service for agents. The MVP proves one loop:

```sh
AGENT_PASTE_API_KEY=ap_pk_... agent-paste publish ./site --ttl 30d
```

The command uploads a single HTML file or an HTML folder, returns stable URLs for a human and another agent, and expires the artifact later so the service does not accumulate cruft forever.

## Product Promise

An agent should be able to publish a generated HTML work product with one command and hand off a durable URL. A human can open the result in a browser. Another agent can fetch a small JSON manifest with full per-file URLs. The hosted service treats uploaded bytes as untrusted and deletes expired artifacts automatically.

The MVP is intentionally smaller than the original platform plan:

- Hosted from day one on Cloudflare.
- Public product surface is the `agent-paste` CLI.
- Public CLI auth is API-key only.
- OAuth, dashboard, MCP, access-link lifecycle, bundles, multi-revision artifacts, billing, and app-layer encryption are future phases.
- Retention is part of the MVP.

## Actors

**API Key Publisher**:
An agent, CI job, script, or developer using `AGENT_PASTE_API_KEY`. This is the only public publishing actor in the MVP.

**Unauthenticated Recipient**:
A human or agent with a signed URL returned by publish. This actor can view only the artifact/revision encoded in the signed URL and only until the artifact expires or is deleted.

**Operator**:
The repo owner or Codex-assisted maintainer using an internal admin CLI with `AGENT_PASTE_ADMIN_TOKEN`. Operators create workspaces and API keys, inspect artifacts, delete artifacts, and run cleanup.

## Surfaces

**Public CLI**:
The public product surface. MVP commands are:

```sh
agent-paste publish <path> [--title "..."] [--ttl 30d]
agent-paste whoami
```

**Admin CLI**:
A repo-local operations tool, not a public product. It wraps internal admin REST APIs so Codex can help manage the hosted system without an admin UI.

**API Worker**:
Owns API-key auth, artifact metadata, public Agent View, admin REST APIs, operation events, and scheduled cleanup.

**Upload Worker**:
Owns upload sessions, signed upload-worker PUT URLs, upload size/count validation, and R2 writes.

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
  "view_url": "https://usercontent.agent-paste.sh/v/{content_token}/index.html",
  "agent_view_url": "https://api.agent-paste.sh/v1/public/agent-view/{agent_view_token}",
  "expires_at": "2026-06-19T12:00:00.000Z"
}
```

`view_url` is a direct signed content URL. The token lives in the path for the MVP. Fragment-based access links are a later phase.

`agent_view_url` is public and signed. It returns a JSON manifest for the same revision.

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
  "view_url": "https://usercontent.agent-paste.sh/v/{content_token}/index.html",
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
2. CLI calls `POST upload /v1/upload-sessions` with file paths, sizes, title, TTL, and an idempotency key.
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

OAuth login is deferred. The future public flow may add:

```sh
agent-paste login
```

Admin auth uses a separate noninteractive operator token:

```sh
AGENT_PASTE_ADMIN_TOKEN=... pnpm admin artifacts list
```

## Retention

Retention is required in the MVP.

- Default TTL: `30d`.
- Minimum TTL: `1d`.
- Maximum TTL: `90d`.
- Every artifact has `expires_at`.
- Every upload session has `expires_at`.
- Expired artifacts stop resolving and their R2 bytes are deleted by cleanup.
- Expired upload sessions delete partial R2 bytes.
- No forever retention in MVP.
- No pinning in MVP.

Cleanup runs in the API Worker scheduled handler and can also be triggered through the admin CLI.

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

Application-layer encryption is deferred. Private R2 plus isolated content serving is the MVP safety baseline.

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

## Out Of MVP

- Dashboard and admin UI.
- Public OAuth login.
- Self-serve signup.
- MCP server.
- Multi-member workspaces.
- Multi-revision artifacts and updates.
- Latest-moving share links.
- Fragment-based Access Link Signed URLs.
- Link revoke/mint/lockdown lifecycle.
- Bundle generation and download.
- Real safety scanner integration.
- App-layer encryption and key rotation.
- Billing, quotas, and plans.
- Public TypeScript SDK.
- Standalone binary distribution.

## MVP Acceptance Shape

The MVP is buildable when:

- An operator can create a workspace and API key through the admin CLI.
- `agent-paste whoami` works with `AGENT_PASTE_API_KEY`.
- `agent-paste publish ./site` uploads a folder with `index.html`.
- `agent-paste publish ./demo.html` uploads a single HTML file.
- Publish returns `artifact_id`, `revision_id`, `view_url`, `agent_view_url`, and `expires_at`.
- `view_url` opens the HTML from the content origin.
- `agent_view_url` returns JSON with full per-file URLs.
- Expired artifacts stop resolving and their bytes are cleaned up.
- Admin CLI can list, inspect, delete artifacts, and run cleanup.
