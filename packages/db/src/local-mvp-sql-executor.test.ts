import { describe, expect, it } from "vitest";
import { createLocalMvpSqlExecutor } from "./local-mvp-sql-executor.js";
import { createLocalState } from "./repository/local-state.js";
import type { Artifact, Revision } from "./types.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

function seedPublishedRevision(state: ReturnType<typeof createLocalState>) {
  const revision: Revision = {
    id: revisionId,
    workspace_id: workspaceId,
    artifact_id: artifactId,
    revision_number: 1,
    status: "published",
    entrypoint: "index.html",
    render_mode: "html",
    file_count: 1,
    size_bytes: 12,
    bundle_status: "pending",
    bundle_status_updated_at: null,
    bundle_size_bytes: null,
    bytes_purge_enqueued_at: null,
    created_by_type: "api_key",
    created_by_id: "key_1",
    created_at: "2026-01-01T00:00:00.000Z",
    published_at: "2026-01-01T00:00:01.000Z",
  };
  const artifact: Artifact = {
    id: artifactId,
    workspace_id: workspaceId,
    revision_id: revisionId,
    status: "active",
    title: "Harness",
    entrypoint: "index.html",
    file_count: 1,
    size_bytes: 12,
    expires_at: "2026-12-31T00:00:00.000Z",
    pinned_at: null,
    deleted_at: null,
    delete_reason: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:01.000Z",
  };
  state.revisions.set(revisionId, revision);
  state.artifacts.set(artifactId, artifact);
  state.artifactFiles.set(`${artifactId}:${revisionId}:index.html`, {
    workspace_id: workspaceId,
    artifact_id: artifactId,
    revision_id: revisionId,
    path: "index.html",
    size_bytes: 12,
    content_type: "text/html",
    r2_key: `artifacts/${artifactId}/revisions/${revisionId}/index.html`,
    uploaded_at: "2026-01-01T00:00:01.000Z",
  });
}

describe("createLocalMvpSqlExecutor", () => {
  it("loads revision bundle state and files for bundle-generate", async () => {
    const state = createLocalState();
    seedPublishedRevision(state);
    const executor = createLocalMvpSqlExecutor(state);

    const revision = await executor.query(
      `select r.status, a.status as artifact_status, r.bundle_status
       from revisions r
       inner join artifacts a on a.id = r.artifact_id
       where r.workspace_id = $1 and r.id = $2`,
      [workspaceId, revisionId],
    );
    expect(revision.rows[0]).toMatchObject({
      status: "published",
      artifact_status: "active",
      bundle_status: "pending",
    });

    const files = await executor.query(
      `select path, r2_key
       from artifact_files
       where artifact_id = $1 and revision_id = $2
       order by path asc`,
      [artifactId, revisionId],
    );
    expect(files.rows).toEqual([
      { path: "index.html", r2_key: `artifacts/${artifactId}/revisions/${revisionId}/index.html` },
    ]);
  });

  it("marks bundle ready and records idempotency completions", async () => {
    const state = createLocalState();
    seedPublishedRevision(state);
    const executor = createLocalMvpSqlExecutor(state);

    await executor.query(
      `insert into idempotency_records
         (workspace_id, actor_type, actor_id, operation, idempotency_key, status, result_json, created_at, completed_at)
       values ($1, $2, $3, $4, $5, 'in_flight', null, $6, null)
       on conflict do nothing
       returning workspace_id`,
      [workspaceId, "system", "bundle_generate", "bundle.mark_ready", revisionId, "2026-01-01T00:00:02.000Z"],
    );

    await executor.query(
      `update revisions
       set bundle_status = 'ready',
           bundle_size_bytes = $3,
           bundle_status_updated_at = now()
       where workspace_id = $1 and id = $2 and bundle_status = 'pending'`,
      [workspaceId, revisionId, 128],
    );

    await executor.query(
      `update idempotency_records
       set status = 'completed', result_json = $6::jsonb, completed_at = $7
       where workspace_id is not distinct from $1
         and actor_type = $2 and actor_id = $3 and operation = $4 and idempotency_key = $5`,
      [
        workspaceId,
        "system",
        "bundle_generate",
        "bundle.mark_ready",
        revisionId,
        JSON.stringify({ revision_id: revisionId, bundle_status: "ready", bundle_size_bytes: 128 }),
        "2026-01-01T00:00:02.000Z",
      ],
    );

    expect(state.revisions.get(revisionId)?.bundle_status).toBe("ready");
    expect(state.revisions.get(revisionId)?.bundle_size_bytes).toBe(128);
  });

  it("supports purge recovery discovery and artifact inspection queries", async () => {
    const state = createLocalState();
    seedPublishedRevision(state);
    const artifact = state.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error("expected artifact");
    }
    artifact.status = "deleted";
    artifact.deleted_at = "2026-01-02T00:00:00.000Z";

    const executor = createLocalMvpSqlExecutor(state);
    const inspection = await executor.query(
      `select id, workspace_id, revision_id, status, deleted_at
       from artifacts
       where id = $1`,
      [artifactId],
    );
    expect(inspection.rows[0]).toMatchObject({
      id: artifactId,
      status: "deleted",
      revision_id: revisionId,
    });

    const recovery = await executor.query(
      `select a.id, a.workspace_id, a.revision_id, a.status
       from artifacts a
       inner join revisions r on r.id = a.revision_id and r.artifact_id = a.id
       where a.status in ('deleted', 'expired')
         and a.revision_id is not null
         and r.bytes_purge_enqueued_at is null
       order by a.updated_at asc
       limit $1`,
      [10],
    );
    expect(recovery.rows).toHaveLength(1);

    await executor.query(
      `update revisions
       set bytes_purge_enqueued_at = now()
       where workspace_id = $1 and id = $2 and artifact_id = $3
       returning id`,
      [workspaceId, revisionId, artifactId],
    );
    expect(state.revisions.get(revisionId)?.bytes_purge_enqueued_at).toEqual(expect.any(String));

    const afterEnqueue = await executor.query(
      `select a.id
       from artifacts a
       inner join revisions r on r.id = a.revision_id and r.artifact_id = a.id
       where a.status in ('deleted', 'expired')
         and r.bytes_purge_enqueued_at is null
       limit $1`,
      [10],
    );
    expect(afterEnqueue.rows).toHaveLength(0);
  });

  it("replays completed idempotency records and marks bundle failed", async () => {
    const state = createLocalState();
    seedPublishedRevision(state);
    const executor = createLocalMvpSqlExecutor(state);

    await executor.query(
      `insert into idempotency_records
         (workspace_id, actor_type, actor_id, operation, idempotency_key, status, result_json, created_at, completed_at)
       values ($1, $2, $3, $4, $5, 'in_flight', null, $6, null)
       on conflict do nothing
       returning workspace_id`,
      [workspaceId, "system", "bundle_generate", "bundle.mark_failed", revisionId, "2026-01-01T00:00:02.000Z"],
    );
    await executor.query(
      `update idempotency_records
       set status = 'completed', result_json = $6::jsonb, completed_at = $7
       where workspace_id is not distinct from $1
         and actor_type = $2 and actor_id = $3 and operation = $4 and idempotency_key = $5`,
      [
        workspaceId,
        "system",
        "bundle_generate",
        "bundle.mark_failed",
        revisionId,
        JSON.stringify({ revision_id: revisionId, bundle_status: "failed" }),
        "2026-01-01T00:00:03.000Z",
      ],
    );

    const replay = await executor.query(
      `select status, result_json, created_at
       from idempotency_records
       where workspace_id is not distinct from $1
         and actor_type = $2 and actor_id = $3 and operation = $4 and idempotency_key = $5
       for update`,
      [workspaceId, "system", "bundle_generate", "bundle.mark_failed", revisionId],
    );
    expect(replay.rows[0]).toMatchObject({ status: "completed" });

    await executor.query(
      `update revisions
       set bundle_status = 'failed', bundle_status_updated_at = now(), bundle_size_bytes = null
       where workspace_id = $1 and id = $2 and bundle_status = 'pending'`,
      [workspaceId, revisionId],
    );
    expect(state.revisions.get(revisionId)?.bundle_status).toBe("failed");
  });
});
