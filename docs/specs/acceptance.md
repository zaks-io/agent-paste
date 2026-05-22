# MVP Acceptance Matrix

The MVP is ready when these scenarios can be automated locally and in preview. Each scenario should become one or more integration tests.

## Admin Bootstrap

| Scenario                          | Expected Result                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Missing `AGENT_PASTE_ADMIN_TOKEN` | Admin CLI refuses to run.                                                                                                          |
| Create workspace                  | `pnpm admin workspace create --email user@example.com` creates a workspace and records an operation event.                         |
| Create API key                    | `pnpm admin api-key create --workspace <id> --name default` returns plaintext secret once and stores only derived secret material. |
| Revoke API key                    | Future public CLI calls using that key fail.                                                                                       |

## Public CLI

| Scenario                            | Expected Result                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Missing `AGENT_PASTE_API_KEY`       | `agent-paste whoami` and `publish` fail with a clear local error before network calls.         |
| Valid API key                       | `agent-paste whoami` returns workspace and API key identity without secret material.           |
| Publish single HTML file            | Creates one Artifact and one Revision, returns `view_url`, `agent_view_url`, and `expires_at`. |
| Publish folder with `index.html`    | Entrypoint is inferred and subresources load from signed content URLs.                         |
| Publish folder without `index.html` | CLI or upload validation fails; no active Artifact is created.                                 |
| Publish over file cap               | Fails before finalize and records no active Artifact.                                          |
| Retry same idempotency key          | Returns the same durable identifiers without duplicate artifacts.                              |

## Upload

| Scenario               | Expected Result                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Create upload session  | Returns reserved `artifact_id`, `revision_id`, and per-file upload-worker PUT URLs. |
| PUT all files          | Upload Worker writes private R2 objects and never exposes R2 URLs.                  |
| Finalize missing file  | Finalize fails and no active Artifact is created.                                   |
| Expired upload session | Cleanup marks the session expired and deletes partial R2 bytes.                     |

## Reading

| Scenario               | Expected Result                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Open `view_url`        | Browser receives HTML from `usercontent.agent-paste.sh` with MVP security headers.         |
| Load static asset      | Asset referenced by HTML loads from the same content origin when included in the artifact. |
| Fetch `agent_view_url` | Returns Agent View JSON with full per-file signed URLs.                                    |
| Fetch unknown path     | Returns generic `not_found`.                                                               |
| Expired signed token   | Returns generic `not_found`.                                                               |
| Deleted artifact token | Returns generic `not_found` after denylist propagation.                                    |

## Retention

| Scenario             | Expected Result                                                               |
| -------------------- | ----------------------------------------------------------------------------- |
| Default TTL          | Publish without `--ttl` sets artifact expiration to `30d`.                    |
| Max TTL              | Publish with a TTL over `90d` is rejected with a validation error.            |
| Artifact expiration  | Scheduled cleanup marks the artifact expired/deleted and removes R2 bytes.    |
| Manual cleanup       | `pnpm admin cleanup run` performs the same cleanup work and reports counts.   |
| No forever artifacts | There is no supported MVP path that creates an artifact without `expires_at`. |

## Admin Operations

| Scenario             | Expected Result                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| List artifacts       | Admin CLI can filter by workspace and status.                                                  |
| Inspect artifact     | Admin CLI shows metadata, files, expiry, and operation-event references without signed tokens. |
| Delete artifact      | Admin CLI requires explicit confirmation flag and makes future content reads fail.             |
| Operation event list | Admin CLI can show recent operation events for workspace/key/upload/artifact/cleanup actions.  |

## Security Boundaries

| Scenario                    | Expected Result                                                           |
| --------------------------- | ------------------------------------------------------------------------- |
| Content Worker DB binding   | Generated Worker binding types prove `content` has no Hyperdrive binding. |
| Signed URL logging          | Tests fail if request logging records full signed content URLs or tokens. |
| API key logging             | Tests fail if API-key secret material is logged.                          |
| Admin token on public route | Rejected as an invalid public API key.                                    |
| API key on admin route      | Rejected as an invalid admin token.                                       |

## Explicit Non-Goals

These should not be required for MVP acceptance:

- Public OAuth login.
- Dashboard or admin UI.
- MCP server.
- Multi-revision updates.
- Latest-moving share links.
- Fragment-based Access Link Signed URLs.
- Bundle generation/download.
- App-layer encryption.
- Real safety scanner integration.
