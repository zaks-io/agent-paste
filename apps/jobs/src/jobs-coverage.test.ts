import { describe, expect, it, vi } from "vitest";
import { MAINTENANCE_GC_SWEEP_CAP, UPLOAD_CLEANUP_SWEEP_CAP } from "./constants.js";
import { runScheduledJobs } from "./cron.js";
import { runMaintenanceGc } from "./discovery/maintenance-gc.js";
import { runUploadCleanupDiscovery } from "./discovery/upload-cleanup.js";
import { handleQueueBatch as handleQueueBatchExported } from "./index.js";
import { handleQueueBatch } from "./queue.js";
import { deletePrefixes } from "./r2-purge.js";
import { createTransactionalSqlExecutor } from "./test-helpers/sql-executor.js";

const sampleAuditRow = (id: string) => ({
  id,
  workspace_id: "00000000-0000-4000-8000-000000000001",
  actor_type: "system",
  actor_id: "maintenance_gc",
  action: "artifact.deleted",
  target_type: "artifact",
  target_id: "art_01",
  details: {},
  request_id: null,
  occurred_at: "2025-12-01T12:00:00.000Z",
});

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

describe("maintenance GC sweep caps", () => {
  it("sets cap_hit when idempotency deletes fill the sweep cap", async () => {
    const rows = Array.from({ length: MAINTENANCE_GC_SWEEP_CAP }, (_, index) => ({ id: String(index) }));
    const executor = createTransactionalSqlExecutor(async (sql: string) => {
      if (sql.includes("idempotency_records")) {
        return { rows };
      }
      return { rows: [] };
    });
    const result = await runMaintenanceGc(executor, "2026-05-20T00:00:00.000Z", {
      list: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(async () => null),
      put: vi.fn(),
    });
    expect(result.cap_hit).toBe(true);
    expect(result.discovered).toBe(MAINTENANCE_GC_SWEEP_CAP);
    expect(executor.query).toHaveBeenCalled();
  });

  it("sets cap_hit when audit deletes consume the remaining budget", async () => {
    const idempotencyRows = [{ id: "1" }];
    const auditRows = Array.from({ length: MAINTENANCE_GC_SWEEP_CAP - 1 }, (_, index) =>
      sampleAuditRow(`evt_${index}`),
    );
    const executor = createTransactionalSqlExecutor(async (sql: string) => {
      if (sql.includes("idempotency_records")) {
        return { rows: idempotencyRows };
      }
      if (sql.includes("from operation_events") && sql.trimStart().startsWith("select")) {
        return { rows: auditRows };
      }
      if (sql.includes("delete from operation_events")) {
        return { rows: auditRows.map((row) => ({ id: row.id })) };
      }
      return { rows: [] };
    });
    const result = await runMaintenanceGc(executor, "2026-05-20T00:00:00.000Z", {
      list: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(async () => null),
      put: vi.fn(),
    });
    expect(result.cap_hit).toBe(true);
    expect(result.discovered).toBe(MAINTENANCE_GC_SWEEP_CAP);
  });
});

describe("upload cleanup discovery", () => {
  it("expires sessions with no files without enqueueing purge work", async () => {
    const send = vi.fn();
    const executor = createTransactionalSqlExecutor(async (sql: string) => {
      if (sql.includes("upload_sessions") && sql.trimStart().startsWith("select")) {
        return {
          rows: [
            {
              id: "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
              workspace_id: workspaceId,
              artifact_id: artifactId,
              revision_id: revisionId,
            },
          ],
        };
      }
      if (sql.includes("upload_session_files")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const result = await runUploadCleanupDiscovery(executor, { send, sendBatch: vi.fn() }, "2026-05-20T00:00:00.000Z");
    expect(send).not.toHaveBeenCalled();
    expect(result.enqueued).toBe(0);
    expect(executor.query).toHaveBeenCalled();
  });

  it("reports cap_hit when more sessions are due than the sweep cap", async () => {
    const sessionRows = Array.from({ length: UPLOAD_CLEANUP_SWEEP_CAP + 1 }, (_, index) => ({
      id: `upl_${String(index).padStart(26, "0")}`,
      workspace_id: workspaceId,
      artifact_id: artifactId,
      revision_id: revisionId,
    }));
    const executor = createTransactionalSqlExecutor(async (sql: string) => {
      if (sql.includes("upload_sessions") && sql.trimStart().startsWith("select")) {
        return { rows: sessionRows };
      }
      return { rows: [] };
    });
    const result = await runUploadCleanupDiscovery(executor, { send: vi.fn(), sendBatch: vi.fn() }, "now");
    expect(result.cap_hit).toBe(true);
    expect(result.discovered).toBe(UPLOAD_CLEANUP_SWEEP_CAP);
  });
});

describe("cron and queue routing edges", () => {
  it("logs when the database binding is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await runScheduledJobs({ scheduledTime: Date.now(), cron: "0 * * * *" }, {});
    expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("cron.database_unavailable"))).toBe(true);
    errorSpy.mockRestore();
  });

  it("logs when upload cleanup lacks the purge queue binding", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const executor = { query: vi.fn(), transaction: vi.fn() };
    await runScheduledJobs({ scheduledTime: Date.now(), cron: "*/15 * * * *" }, { DB: executor });
    expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("cron.queue_binding_missing"))).toBe(true);
    errorSpy.mockRestore();
  });

  it("retries unknown queue messages without acking them", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await handleQueueBatch({ queue: "unknown-queue", messages: [{ body: {}, ack, retry }] }, {});
    expect(retry).toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
  });

  it("continues hourly discovery when one sweep task fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const executor = createTransactionalSqlExecutor(async (sql: string) => {
      if (sql.includes("from artifacts")) {
        throw new Error("auto_deletion_failed");
      }
      return { rows: [] };
    });
    await runScheduledJobs(
      { scheduledTime: Date.now(), cron: "0 * * * *" },
      { DB: executor, BYTE_PURGE_QUEUE: { send: vi.fn(), sendBatch: vi.fn() } },
    );
    expect(executor.query).toHaveBeenCalled();
    expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("cron.hourly_task.failed"))).toBe(true);
    errorSpy.mockRestore();
  });

  it("logs unknown cron schedules", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const executor = { query: vi.fn(), transaction: vi.fn() };
    await runScheduledJobs({ scheduledTime: Date.now(), cron: "invalid cron" }, { DB: executor });
    expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("cron.unknown_schedule"))).toBe(true);
    errorSpy.mockRestore();
  });
});

describe("queue handler failure isolation", () => {
  it("retries byte purge when the payload is invalid", async () => {
    const retry = vi.fn();
    await handleQueueBatchExported(
      {
        queue: "byte-purge",
        messages: [{ body: { type: "byte.purge.v1" }, ack: vi.fn(), retry }],
      },
      {
        ARTIFACTS: {
          list: async () => ({ objects: [], truncated: false }),
          delete: async () => {},
        },
      },
    );
    expect(retry).toHaveBeenCalled();
  });

  it("retries safety scan when revision state cannot be loaded", async () => {
    const retry = vi.fn();
    await handleQueueBatchExported(
      {
        queue: "safety-scan",
        messages: [
          {
            body: {
              type: "safety.scan.v1",
              workspace_id: workspaceId,
              artifact_id: artifactId,
              revision_id: revisionId,
              scanner_id: "stub_v1",
              scanner_version: "1",
              requested_at: "2026-05-20T00:00:00.000Z",
            },
            ack: vi.fn(),
            retry,
          },
        ],
      },
      {
        DB: {
          query: vi.fn(async () => {
            throw new Error("db_read_failed");
          }),
          transaction: vi.fn(),
        },
      },
    );
    expect(retry).toHaveBeenCalled();
  });

  it("acks invalid bundle generate DLQ payloads without retrying", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await handleQueueBatchExported(
      {
        queue: "bundle-generate-dlq",
        messages: [{ body: { type: "bundle.generate.v1" }, ack, retry }],
      },
      { DB: { query: vi.fn(), transaction: vi.fn() } },
    );
    expect(ack).toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it("retries bundle generate DLQ when mark_failed fails", async () => {
    const retry = vi.fn();
    await handleQueueBatchExported(
      {
        queue: "bundle-generate-dlq",
        messages: [
          {
            body: {
              type: "bundle.generate.v1",
              workspace_id: workspaceId,
              artifact_id: artifactId,
              revision_id: revisionId,
              requested_at: "2026-05-20T00:00:00.000Z",
              reason: "publish",
            },
            ack: vi.fn(),
            retry,
          },
        ],
      },
      {
        DB: {
          query: vi.fn(async () => {
            throw new Error("db_write_failed");
          }),
          transaction: vi.fn(async () => {
            throw new Error("db_write_failed");
          }),
        },
      },
    );
    expect(retry).toHaveBeenCalled();
  });

  it("acks bundle generate when the revision row is missing", async () => {
    const ack = vi.fn();
    await handleQueueBatchExported(
      {
        queue: "bundle-generate",
        messages: [
          {
            body: {
              type: "bundle.generate.v1",
              workspace_id: workspaceId,
              artifact_id: artifactId,
              revision_id: revisionId,
              requested_at: "2026-05-20T00:00:00.000Z",
              reason: "publish",
            },
            ack,
            retry: vi.fn(),
          },
        ],
      },
      { DB: createTransactionalSqlExecutor(async () => ({ rows: [] })) },
    );
    expect(ack).toHaveBeenCalled();
  });

  it("retries bundle generate when the payload is invalid", async () => {
    const retry = vi.fn();
    await handleQueueBatchExported(
      {
        queue: "bundle-generate",
        messages: [{ body: { type: "bundle.generate.v1" }, ack: vi.fn(), retry }],
      },
      { DB: { query: vi.fn(), transaction: vi.fn() } },
    );
    expect(retry).toHaveBeenCalled();
  });
});

describe("r2 purge pagination", () => {
  it("follows list cursors across pages", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        objects: [{ key: "env/live/a/1.txt" }],
        truncated: true,
        cursor: "page-2",
      })
      .mockResolvedValueOnce({
        objects: [{ key: "env/live/a/2.txt" }],
        truncated: false,
      });
    const deleted: string[][] = [];
    const count = await deletePrefixes(
      {
        list,
        delete: async (keys) => {
          deleted.push(keys);
        },
      },
      ["env/live/a/"],
    );
    expect(count).toBe(2);
    expect(list).toHaveBeenCalledTimes(2);
    expect(deleted).toEqual([["env/live/a/1.txt"], ["env/live/a/2.txt"]]);
  });
});
