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
      {
        path: "index.html",
        r2_key: `artifacts/${artifactId}/revisions/${revisionId}/index.html`,
        served_content_type: "text/html",
      },
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

  it("preserves object-valued operation event details", async () => {
    const state = createLocalState();
    const executor = createLocalMvpSqlExecutor(state);

    await executor.query(
      `insert into operation_events
         (id, workspace_id, actor_type, actor_id, action, target_type, target_id, details, request_id, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [
        "evt_1",
        workspaceId,
        "system",
        "safety_scan",
        "safety_warnings.replaced",
        "revision",
        revisionId,
        { warning_count: 2 },
        null,
        "2026-01-01T00:00:02.000Z",
      ],
    );

    expect(state.operationEvents.get("evt_1")?.details).toEqual({ warning_count: 2 });
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

  it("ignores malformed idempotency inserts and duplicate keys", async () => {
    const state = createLocalState();
    const executor = createLocalMvpSqlExecutor(state);

    const malformed = await executor.query(
      `insert into idempotency_records
         (workspace_id, actor_type, actor_id, operation, idempotency_key, status, result_json, created_at, completed_at)
       values ($1, $2, $3, $4, $5, 'in_flight', null, $6, null)
       returning workspace_id`,
      [workspaceId, "system", "bundle_generate", "bundle.mark_ready"],
    );
    expect(malformed.rows).toEqual([]);

    const first = await executor.query(
      `insert into idempotency_records
         (workspace_id, actor_type, actor_id, operation, idempotency_key, status, result_json, created_at, completed_at)
       values ($1, $2, $3, $4, $5, 'in_flight', null, $6, null)
       returning workspace_id`,
      [workspaceId, "system", "bundle_generate", "bundle.mark_ready", revisionId, "2026-01-01T00:00:02.000Z"],
    );
    expect(first.rows).toEqual([{ workspace_id: workspaceId }]);

    const duplicate = await executor.query(
      `insert into idempotency_records
         (workspace_id, actor_type, actor_id, operation, idempotency_key, status, result_json, created_at, completed_at)
       values ($1, $2, $3, $4, $5, 'in_flight', null, $6, null)
       returning workspace_id`,
      [workspaceId, "system", "bundle_generate", "bundle.mark_ready", revisionId, "2026-01-01T00:00:03.000Z"],
    );
    expect(duplicate.rows).toEqual([]);
  });

  it("returns empty rows for missing idempotency records and no-ops updates", async () => {
    const state = createLocalState();
    const executor = createLocalMvpSqlExecutor(state);

    const missingSelect = await executor.query(
      `select status, result_json, created_at
       from idempotency_records
       where workspace_id is not distinct from $1
         and actor_type = $2 and actor_id = $3 and operation = $4 and idempotency_key = $5
       for update`,
      [null, "system", "bundle_generate", "bundle.mark_ready", revisionId],
    );
    expect(missingSelect.rows).toEqual([]);

    await executor.query(
      `update idempotency_records
       set status = 'in_flight', result_json = null, completed_at = null, created_at = $6
       where workspace_id is not distinct from $1
         and actor_type = $2 and actor_id = $3 and operation = $4 and idempotency_key = $5
         and status = 'completed'`,
      [workspaceId, "system", "bundle_generate", "bundle.mark_ready", revisionId, "2026-01-01T00:00:04.000Z"],
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
        JSON.stringify({ revision_id: revisionId }),
        "2026-01-01T00:00:05.000Z",
      ],
    );
  });

  it("resets in-flight idempotency records and completes with string result_json", async () => {
    const state = createLocalState();
    const executor = createLocalMvpSqlExecutor(state);

    await executor.query(
      `insert into idempotency_records
         (workspace_id, actor_type, actor_id, operation, idempotency_key, status, result_json, created_at, completed_at)
       values ($1, $2, $3, $4, $5, 'in_flight', null, $6, null)
       returning workspace_id`,
      [null, "system", "bundle_generate", "bundle.mark_ready", revisionId, "2026-01-01T00:00:02.000Z"],
    );

    await executor.query(
      `update idempotency_records
       set status = 'in_flight', result_json = null, completed_at = null, created_at = $6
       where workspace_id is not distinct from $1
         and actor_type = $2 and actor_id = $3 and operation = $4 and idempotency_key = $5
         and status = 'completed'`,
      [null, "system", "bundle_generate", "bundle.mark_ready", revisionId, "2026-01-01T00:00:03.000Z"],
    );

    await executor.query(
      `update idempotency_records
       set status = 'completed', result_json = $6::jsonb, completed_at = $7
       where workspace_id is not distinct from $1
         and actor_type = $2 and actor_id = $3 and operation = $4 and idempotency_key = $5`,
      [
        null,
        "system",
        "bundle_generate",
        "bundle.mark_ready",
        revisionId,
        { revision_id: revisionId, bundle_status: "ready" },
        "2026-01-01T00:00:04.000Z",
      ],
    );

    const replay = await executor.query(
      `select status, result_json, created_at
       from idempotency_records
       where workspace_id is not distinct from $1
         and actor_type = $2 and actor_id = $3 and operation = $4 and idempotency_key = $5
       for update`,
      [null, "system", "bundle_generate", "bundle.mark_ready", revisionId],
    );
    expect(replay.rows[0]).toMatchObject({
      status: "completed",
      result_json: { revision_id: revisionId, bundle_status: "ready" },
      created_at: "2026-01-01T00:00:03.000Z",
    });
  });

  it("ignores short safety-warning inserts and supports select/delete round-trips", async () => {
    const state = createLocalState();
    const executor = createLocalMvpSqlExecutor(state);

    await executor.query(`insert into safety_warnings values ($1)`, ["warn_short"]);
    expect(state.safetyWarnings.size).toBe(0);

    await executor.query(
      `insert into safety_warnings
         (id, workspace_id, artifact_id, revision_id, scanner_id, scanner_version, code, severity, scope, file_path, message, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        "warn_1",
        workspaceId,
        artifactId,
        revisionId,
        "html",
        "1.0.0",
        "inline-script",
        "high",
        "page",
        null,
        "Inline script detected",
        "2026-01-01T00:00:02.000Z",
      ],
    );
    await executor.query(
      `insert into safety_warnings
         (id, workspace_id, artifact_id, revision_id, scanner_id, scanner_version, code, severity, scope, file_path, message, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        "warn_2",
        workspaceId,
        artifactId,
        revisionId,
        "html",
        "1.0.0",
        "external-script",
        "medium",
        "asset",
        "app.js",
        "External script reference",
        "2026-01-01T00:00:02.000Z",
      ],
    );

    const selected = await executor.query(
      `select code, severity, scope, file_path, message
       from safety_warnings
       where workspace_id = $1 and revision_id = $2 and scanner_id = $3
       order by scope asc, file_path asc nulls first, code asc`,
      [workspaceId, revisionId, "html"],
    );
    expect(selected.rows).toEqual([
      {
        code: "external-script",
        severity: "medium",
        scope: "asset",
        file_path: "app.js",
        message: "External script reference",
      },
      {
        code: "inline-script",
        severity: "high",
        scope: "page",
        file_path: null,
        message: "Inline script detected",
      },
    ]);

    await executor.query(
      `insert into safety_warnings
         (id, workspace_id, artifact_id, revision_id, scanner_id, scanner_version, code, severity, scope, file_path, message, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        "warn_page_b",
        workspaceId,
        artifactId,
        revisionId,
        "html",
        "1.0.0",
        "b-page",
        "low",
        "page",
        null,
        "Second page warning",
        "2026-01-01T00:00:02.000Z",
      ],
    );
    await executor.query(
      `insert into safety_warnings
         (id, workspace_id, artifact_id, revision_id, scanner_id, scanner_version, code, severity, scope, file_path, message, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        "warn_page_a",
        workspaceId,
        artifactId,
        revisionId,
        "html",
        "1.0.0",
        "a-page",
        "low",
        "page",
        null,
        "First page warning",
        "2026-01-01T00:00:02.000Z",
      ],
    );
    await executor.query(
      `insert into safety_warnings
         (id, workspace_id, artifact_id, revision_id, scanner_id, scanner_version, code, severity, scope, file_path, message, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        "warn_3",
        workspaceId,
        artifactId,
        revisionId,
        "html",
        "1.0.0",
        "z-code",
        "low",
        "asset",
        "z.js",
        "Later file path",
        "2026-01-01T00:00:02.000Z",
      ],
    );
    await executor.query(
      `insert into safety_warnings
         (id, workspace_id, artifact_id, revision_id, scanner_id, scanner_version, code, severity, scope, file_path, message, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        "warn_4",
        workspaceId,
        artifactId,
        revisionId,
        "html",
        "1.0.0",
        "a-code",
        "low",
        "asset",
        "z.js",
        "Same file different code",
        "2026-01-01T00:00:02.000Z",
      ],
    );
    await executor.query(
      `insert into safety_warnings
         (id, workspace_id, artifact_id, revision_id, scanner_id, scanner_version, code, severity, scope, file_path, message, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        "warn_other_scanner",
        workspaceId,
        artifactId,
        revisionId,
        "other",
        "1.0.0",
        "ignored",
        "low",
        "asset",
        "ignored.js",
        "Different scanner",
        "2026-01-01T00:00:02.000Z",
      ],
    );

    const sameScopeSort = await executor.query(
      `select code, file_path
       from safety_warnings
       where workspace_id = $1 and revision_id = $2 and scanner_id = $3
       order by scope asc, file_path asc nulls first, code asc`,
      [workspaceId, revisionId, "html"],
    );
    expect(sameScopeSort.rows.map((row) => row.code)).toEqual([
      "external-script",
      "a-code",
      "z-code",
      "a-page",
      "b-page",
      "inline-script",
    ]);

    await executor.query(
      `delete from safety_warnings
       where workspace_id = $1 and revision_id = $2 and scanner_id = $3`,
      [workspaceId, revisionId, "html"],
    );
    expect(state.safetyWarnings.size).toBe(1);
    expect(state.safetyWarnings.has("warn_other_scanner")).toBe(true);
  });

  it("parses operation event details from strings and falls back for invalid values", async () => {
    const state = createLocalState();
    const executor = createLocalMvpSqlExecutor(state);

    await executor.query(`insert into operation_events values ($1)`, ["evt_short"]);
    expect(state.operationEvents.size).toBe(0);

    await executor.query(
      `insert into operation_events
         (id, workspace_id, actor_type, actor_id, action, target_type, target_id, details, request_id, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [
        "evt_string",
        null,
        "system",
        null,
        "safety_warnings.replaced",
        "revision",
        revisionId,
        JSON.stringify({ warning_count: 1 }),
        "req_1",
        "2026-01-01T00:00:02.000Z",
      ],
    );
    await executor.query(
      `insert into operation_events
         (id, workspace_id, actor_type, actor_id, action, target_type, target_id, details, request_id, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [
        "evt_invalid",
        workspaceId,
        "system",
        "safety_scan",
        "safety_warnings.replaced",
        "revision",
        revisionId,
        ["not", "an", "object"],
        null,
        "2026-01-01T00:00:03.000Z",
      ],
    );

    expect(state.operationEvents.get("evt_string")?.details).toEqual({ warning_count: 1 });
    expect(state.operationEvents.get("evt_string")).toMatchObject({
      workspace_id: null,
      actor_id: null,
      request_id: "req_1",
    });
    expect(state.operationEvents.get("evt_invalid")?.details).toEqual({});
  });

  it("returns empty revision joins when revision or artifact is missing", async () => {
    const state = createLocalState();
    seedPublishedRevision(state);
    const executor = createLocalMvpSqlExecutor(state);

    const missingRevision = await executor.query(
      `select r.status, a.status as artifact_status, r.bundle_status
       from revisions r
       inner join artifacts a on a.id = r.artifact_id
       where r.workspace_id = $1 and r.id = $2`,
      [workspaceId, "rev_missing"],
    );
    expect(missingRevision.rows).toEqual([]);

    const wrongWorkspace = await executor.query(
      `select r.status, a.status as artifact_status, r.bundle_status
       from revisions r
       inner join artifacts a on a.id = r.artifact_id
       where r.workspace_id = $1 and r.id = $2`,
      ["00000000-0000-4000-8000-000000000099", revisionId],
    );
    expect(wrongWorkspace.rows).toEqual([]);

    state.artifacts.delete(artifactId);
    const missingArtifact = await executor.query(
      `select r.status, a.status as artifact_status, r.bundle_status
       from revisions r
       inner join artifacts a on a.id = r.artifact_id
       where r.workspace_id = $1 and r.id = $2`,
      [workspaceId, revisionId],
    );
    expect(missingArtifact.rows).toEqual([]);
  });

  it("no-ops bundle updates when revision is missing or no longer pending", async () => {
    const state = createLocalState();
    seedPublishedRevision(state);
    const executor = createLocalMvpSqlExecutor(state);

    await executor.query(
      `update revisions
       set bundle_status = 'ready',
           bundle_size_bytes = $3,
           bundle_status_updated_at = now()
       where workspace_id = $1 and id = $2 and bundle_status = 'pending'`,
      [workspaceId, "rev_missing", 64],
    );
    expect(state.revisions.get(revisionId)?.bundle_status).toBe("pending");

    await executor.query(
      `update revisions
       set bundle_status = 'ready',
           bundle_size_bytes = $3,
           bundle_status_updated_at = now()
       where workspace_id = $1 and id = $2 and bundle_status = 'pending'`,
      ["00000000-0000-4000-8000-000000000099", revisionId, 64],
    );
    expect(state.revisions.get(revisionId)?.bundle_status).toBe("pending");

    await executor.query(
      `update revisions
       set bundle_status = 'ready',
           bundle_size_bytes = $3,
           bundle_status_updated_at = now()
       where workspace_id = $1 and id = $2 and bundle_status = 'pending'`,
      [workspaceId, revisionId, 64],
    );
    expect(state.revisions.get(revisionId)?.bundle_status).toBe("ready");

    await executor.query(
      `update revisions
       set bundle_status = 'failed', bundle_status_updated_at = now(), bundle_size_bytes = null
       where workspace_id = $1 and id = $2 and bundle_status = 'pending'`,
      [workspaceId, revisionId],
    );
    expect(state.revisions.get(revisionId)?.bundle_status).toBe("ready");
  });

  it("no-ops bytes purge enqueue when revision lookup fails", async () => {
    const state = createLocalState();
    seedPublishedRevision(state);
    const executor = createLocalMvpSqlExecutor(state);

    const missing = await executor.query(
      `update revisions
       set bytes_purge_enqueued_at = now()
       where workspace_id = $1 and id = $2 and artifact_id = $3
       returning id`,
      [workspaceId, "rev_missing", artifactId],
    );
    expect(missing.rows).toEqual([]);
    expect(state.revisions.get(revisionId)?.bytes_purge_enqueued_at).toBeNull();

    const wrongArtifact = await executor.query(
      `update revisions
       set bytes_purge_enqueued_at = now()
       where workspace_id = $1 and id = $2 and artifact_id = $3
       returning id`,
      [workspaceId, revisionId, "art_missing"],
    );
    expect(wrongArtifact.rows).toEqual([]);
    expect(state.revisions.get(revisionId)?.bytes_purge_enqueued_at).toBeNull();
  });

  it("returns empty artifact inspection rows and filters purge recovery candidates", async () => {
    const state = createLocalState();
    seedPublishedRevision(state);
    const executor = createLocalMvpSqlExecutor(state);

    const missingArtifact = await executor.query(
      `select id, workspace_id, revision_id, status, deleted_at
       from artifacts
       where id = $1`,
      ["art_missing"],
    );
    expect(missingArtifact.rows).toEqual([]);

    const activeArtifact = state.artifacts.get(artifactId);
    if (!activeArtifact) {
      throw new Error("expected artifact");
    }
    activeArtifact.status = "active";

    const deletedNoRevision: Artifact = {
      ...activeArtifact,
      id: "art_deleted_no_revision",
      status: "deleted",
      deleted_at: "2026-01-02T00:00:00.000Z",
      revision_id: null,
    };
    state.artifacts.set(deletedNoRevision.id, deletedNoRevision);

    const baseRevision = state.revisions.get(revisionId);
    if (!baseRevision) {
      throw new Error("expected revision");
    }

    const expiredWithEnqueue: Artifact = {
      ...activeArtifact,
      id: "art_expired_enqueued",
      status: "expired",
      deleted_at: "2026-01-02T00:00:01.000Z",
      revision_id: "rev_expired_enqueued",
    };
    state.artifacts.set(expiredWithEnqueue.id, expiredWithEnqueue);
    state.revisions.set(expiredWithEnqueue.revision_id as string, {
      ...baseRevision,
      id: expiredWithEnqueue.revision_id as string,
      artifact_id: expiredWithEnqueue.id,
      bytes_purge_enqueued_at: "2026-01-02T00:00:02.000Z",
    });

    const deletedEligible: Artifact = {
      ...activeArtifact,
      id: "art_deleted_eligible",
      status: "deleted",
      deleted_at: "2026-01-03T00:00:00.000Z",
      revision_id: "rev_deleted_eligible",
    };
    state.artifacts.set(deletedEligible.id, deletedEligible);
    state.revisions.set(deletedEligible.revision_id as string, {
      ...baseRevision,
      id: deletedEligible.revision_id as string,
      artifact_id: deletedEligible.id,
      bytes_purge_enqueued_at: null,
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
    expect(recovery.rows).toEqual([
      {
        id: deletedEligible.id,
        workspace_id: workspaceId,
        revision_id: deletedEligible.revision_id,
        status: "deleted",
      },
    ]);

    const limitedRecovery = await executor.query(
      `select a.id
       from artifacts a
       inner join revisions r on r.id = a.revision_id and r.artifact_id = a.id
       where a.status in ('deleted', 'expired')
         and r.bytes_purge_enqueued_at is null
       limit $1`,
      [undefined],
    );
    expect(limitedRecovery.rows).toEqual([]);
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
