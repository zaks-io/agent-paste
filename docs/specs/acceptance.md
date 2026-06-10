# MVP Acceptance Matrix

The MVP is ready when these scenarios can be automated locally and in preview. Each scenario should become one or more integration tests.

## Workspace Bootstrap

| Scenario       | Expected Result                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| CLI login      | `agent-paste login` provisions or resolves a member workspace and mints an API key through `/v1/web/keys`.             |
| Smoke harness  | Non-production `POST /__test__/provision-smoke` returns workspace id and one-time API key secret for automated smokes. |
| Revoke API key | `DELETE /v1/web/keys/{api_key_id}` (or harness delete) causes future public CLI calls with that key to fail.           |

## Public CLI

| Scenario                            | Expected Result                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Missing `AGENT_PASTE_API_KEY`       | `agent-paste whoami` and `publish` fail with a clear local error before network calls.                                     |
| Valid API key                       | `agent-paste whoami` returns workspace and API key identity without secret material.                                       |
| Publish single HTML file            | Creates one Artifact and one Revision, returns `artifact_url`, `revision_content_url`, `agent_view_url`, and `expires_at`. |
| Publish folder with `index.html`    | Entrypoint is inferred and subresources load from signed content URLs.                                                     |
| Publish folder without `index.html` | CLI or upload validation fails; no active Artifact is created.                                                             |
| Publish over file cap               | Fails before finalize and records no active Artifact.                                                                      |
| Retry same idempotency key          | Returns the same durable identifiers without duplicate artifacts.                                                          |

`revision_content_url` is the direct signed content URL for the published
Revision. It is not a Share URL or Live Update viewer.

## Upload

| Scenario               | Expected Result                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Create upload session  | Returns reserved `artifact_id`, `revision_id`, and per-file `upload_required` or `reused` targets.                           |
| PUT needed files       | Upload Worker writes private R2 objects for `upload_required` files and never exposes R2 URLs.                               |
| Finalize missing file  | Finalize fails and no active Artifact is created.                                                                            |
| Expired upload session | Cleanup marks the session expired and deletes partial legacy revision-key R2 bytes; shared blob keys are not session-purged. |

## Reading

| Scenario               | Expected Result                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Open `artifact_url`    | Browser opens the app-origin Artifact viewer.                                                          |
| Open content URL       | Browser receives HTML from `usercontent.agent-paste.sh` with MVP security headers.                     |
| Load static asset      | Asset referenced by HTML loads from the same content origin when included in the artifact.             |
| Fetch `agent_view_url` | Returns Agent View JSON with full per-file signed URLs.                                                |
| Fetch unknown path     | Returns generic `not_found`.                                                                           |
| Expired signed token   | Returns generic `not_found`.                                                                           |
| Deleted artifact token | Returns generic `not_found` after denylist propagation.                                                |
| Artifact read throttle | Excess unauthenticated reads for one Artifact return HTTP 429 + `rate_limited_artifact` + Retry-After. |

## Retention

| Scenario             | Expected Result                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Default lifetime     | Publish sets artifact expiration from the Workspace's server-side Auto Deletion policy.        |
| Lifetime bounds      | Workspace settings enforce the server-side min/max Auto Deletion bounds.                       |
| Artifact expiration  | Scheduled cleanup marks the artifact expired/deleted and removes R2 bytes.                     |
| Manual cleanup       | Non-production harness `POST /__test__/run-cleanup` on `jobs` reports expiry and purge counts. |
| No forever artifacts | There is no supported MVP path that creates an artifact without `expires_at`.                  |

## Operator Operations

| Scenario          | Expected Result                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Operator lockdown | WorkOS `admin` (or Access service token) can set/lift lockdowns; API keys cannot call operator routes. |
| Member artifacts  | `/v1/web/artifacts` lists tenant-scoped artifacts without signed tokens in responses.                  |

## Security Boundaries

| Scenario                  | Expected Result                                                           |
| ------------------------- | ------------------------------------------------------------------------- |
| Content Worker DB binding | Generated Worker binding types prove `content` has no Hyperdrive binding. |
| Signed URL logging        | Tests fail if request logging records full signed content URLs or tokens. |
| API key logging           | Tests fail if API-key secret material is logged.                          |
| API key on operator route | Rejected before operator auth runs.                                       |

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
- File-bytes hash-reputation malware scanner integration.
