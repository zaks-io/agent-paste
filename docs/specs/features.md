# Feature Index

This index separates the actual CLI-first MVP from later platform phases. If another spec describes a feature as MVP but this file marks it future, resolve the conflict before implementation.

## MVP Features

### CLI

| Feature               | MVP behavior                                                                                       | Primary users     |
| --------------------- | -------------------------------------------------------------------------------------------------- | ----------------- |
| `agent-paste publish` | Publishes one HTML file or one folder with `index.html`. Returns signed human and Agent View URLs. | API Key Publisher |
| `agent-paste whoami`  | Verifies the API key and returns workspace/key identity.                                           | API Key Publisher |
| API-key auth          | Reads `AGENT_PASTE_API_KEY`. No public OAuth login in MVP.                                         | API Key Publisher |
| TTL option            | `--ttl` sets artifact expiration within platform bounds. Default `30d`, max `90d`.                 | API Key Publisher |
| Title option          | `--title` sets plain-text title. If omitted, CLI infers from file/folder name.                     | API Key Publisher |

### Hosted Workers

| Feature        | MVP behavior                                                                                                       | Primary users             |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| API Worker     | Owns API-key auth, artifact metadata, public Agent View, admin REST APIs, operation events, and scheduled cleanup. | CLI, Operator             |
| Upload Worker  | Owns upload sessions, signed upload-worker PUT URLs, validation, and private R2 writes.                            | CLI                       |
| Content Worker | Serves untrusted content from private R2 through signed URLs. No database binding.                                 | Unauthenticated Recipient |

### Publishing

| Feature                   | MVP behavior                                                                                    | Primary users              |
| ------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------- |
| Artifact                  | A durable uploaded work product. MVP artifacts have exactly one revision.                       | All readers and publishers |
| Revision                  | The immutable file tree created by publish. MVP creates one revision per artifact.              | API Key Publisher          |
| Upload Session            | Temporary workflow for collecting expected files before finalize.                               | CLI                        |
| HTML entrypoint inference | Single `.html` files are accepted. Folders require `index.html`.                                | CLI                        |
| Publish result            | Includes `artifact_id`, `revision_id`, `title`, `view_url`, `agent_view_url`, and `expires_at`. | CLI                        |
| Idempotent publish        | Durable publish steps use idempotency keys so CLI retries do not duplicate artifacts.           | CLI                        |

### Reading

| Feature                        | MVP behavior                                                                                                  | Primary users             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Direct signed view URL         | `https://usercontent.agent-paste.sh/v/{token}/{entrypoint}` opens the exact revision.                         | Unauthenticated Recipient |
| Public signed Agent View       | `https://api.agent-paste.sh/v1/public/agent-view/{token}` returns manifest JSON.                              | Agents, CLI               |
| Full file URLs                 | Agent View includes one signed URL per file. No `content_prefix` in MVP.                                      | Agents                    |
| Extension-derived content type | Content type is chosen from a fixed extension allowlist. Unknown extensions download.                         | Viewers                   |
| HTML CSP                       | Inline JS/styles are allowed, network egress is tightly restricted, and content is isolated on `usercontent`. | Viewers                   |

### Retention And Operations

| Feature            | MVP behavior                                                                               | Primary users |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------- |
| Artifact TTL       | Every artifact expires. Default `30d`, min `1d`, max `90d`.                                | CLI, Operator |
| Upload session TTL | Partial uploads expire and are cleaned up.                                                 | System        |
| Scheduled cleanup  | API Worker scheduled handler expires artifacts and upload sessions, then deletes R2 bytes. | System        |
| Manual cleanup     | Admin CLI can trigger cleanup.                                                             | Operator      |
| Artifact read cap  | Unauthenticated content reads are throttled per Artifact as an abuse ceiling.              | System        |
| Operation events   | Lightweight event log for workspace, key, upload, artifact, cleanup, and admin actions.    | Operator      |

### Operator (web)

| Feature             | MVP behavior                                                                     | Primary users |
| ------------------- | -------------------------------------------------------------------------------- | ------------- |
| Operator auth       | WorkOS `admin` role + Cloudflare Access on web operator routes.                  | Operator      |
| Platform lockdown   | Set/lift/list lockdowns via `/v1/web/admin/lockdowns`.                           | Operator      |
| Member self-service | Workspace, keys, artifacts, and audit via `/v1/web/*` after `agent-paste login`. | Members       |

## Future Features

| Feature                          | Earliest phase | Notes                                                         |
| -------------------------------- | -------------: | ------------------------------------------------------------- |
| Public OAuth login               |        Phase 3 | Adds `agent-paste login` after API-key flow is proven.        |
| Self-serve signup                |        Phase 3 | WorkOS-backed workspace creation.                             |
| Dashboard                        |        Phase 6 | Build only after repeated workflows justify UI.               |
| Multi-revision artifacts         |        Phase 4 | Adds update, revision history, rollback/diff possibilities.   |
| Latest-moving share links        |        Phase 4 | Distinct from revision-pinned links.                          |
| Fragment-based access links      |        Phase 4 | Moves credential material out of request paths.               |
| Access-link revoke/mint/lockdown |        Phase 4 | Requires durable link records and viewer/resolve flow.        |
| Bundle generation/download       |        Phase 4 | Useful once artifacts become larger or multi-revision.        |
| MCP server                       |        Phase 5 | OAuth-only hosted agent integration after core API is stable. |
| App-layer encryption             |        Phase 6 | Adds key management and rotation after usage proves need.     |
| Real safety scanner              |        Phase 6 | Replaces lightweight warnings with scanner lifecycle.         |
| Billing and usage tiers          |       Phase 6+ | Add only when external usage or cost pressure requires it.    |
