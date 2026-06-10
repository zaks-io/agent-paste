import { describe, expect, it, vi } from "vitest";
import {
  CRON_HOURLY_DISCOVERY,
  CRON_UPLOAD_CLEANUP,
  QUEUE_BUNDLE_GENERATE,
  QUEUE_BUNDLE_GENERATE_DLQ,
  QUEUE_BYTE_PURGE,
  QUEUE_SAFETY_SCAN,
} from "./constants.js";
import worker, { type Env, handleQueueBatch, runQueueConsumer, runScheduledEvent, runScheduledJobs } from "./index.js";
import * as queue from "./queue.js";
import { createTransactionalSqlExecutor } from "./test-helpers/sql-executor.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

function request(path: string, env: Env = {}) {
  return worker.fetch(new Request(`https://jobs.test${path}`), env);
}

function createExecutor(rows: Record<string, unknown>[] = []) {
  let call = 0;
  return createTransactionalSqlExecutor(async () => {
    const row = rows[call];
    call += 1;
    return { rows: row ? [row] : [] };
  });
}

describe("jobs worker", () => {
  it("reports health as enabled by default", async () => {
    const response = await request("/healthz");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, app: "jobs", enabled: true });
  });

  it("reports health as disabled when jobs are disabled", async () => {
    const response = await request("/healthz", { JOBS_ENABLED: "false" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, app: "jobs", enabled: false });
  });

  it("retries queue messages without acking or invoking handlers when jobs are disabled", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const handleQueueBatchSpy = vi.spyOn(queue, "handleQueueBatch").mockResolvedValue(undefined);
    await runQueueConsumer({ queue: "byte-purge", messages: [{ body: {}, ack, retry }] }, { JOBS_ENABLED: "false" });
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: expect.any(Number) });
    expect(handleQueueBatchSpy).not.toHaveBeenCalled();
    handleQueueBatchSpy.mockRestore();
  });

  it("skips scheduled jobs when disabled", async () => {
    const executor = createExecutor();
    await expect(
      runScheduledJobs(
        { scheduledTime: Date.now(), cron: CRON_UPLOAD_CLEANUP },
        { JOBS_ENABLED: "false", DB: executor },
      ),
    ).resolves.toBeUndefined();
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("logs and swallows unhandled scheduled job failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const executor = createTransactionalSqlExecutor(async () => {
      throw new Error("db_timeout");
    });
    await expect(
      runScheduledEvent(
        { scheduledTime: Date.now(), cron: CRON_UPLOAD_CLEANUP },
        { DB: executor, BYTE_PURGE_QUEUE: { send: vi.fn(), sendBatch: vi.fn() } },
      ),
    ).resolves.toBeUndefined();
    const cronLog = errorSpy.mock.calls.map((call) => String(call[0])).find((line) => line.includes("cron.unhandled"));
    expect(cronLog).toBeDefined();
    const payload = JSON.parse(cronLog ?? "{}");
    expect(payload).toMatchObject({ event: "cron.unhandled", error: "db_timeout" });
    expect(payload.stack).toContain("Error: db_timeout");
    errorSpy.mockRestore();
  });

  it("leaves upload sessions pending when purge enqueue fails", async () => {
    const send = vi.fn(async () => {
      throw new Error("queue_unavailable");
    });
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
        return { rows: [{ r2_key: "env/live/ws/a/file.txt" }] };
      }
      return { rows: [] };
    });
    await runScheduledJobs(
      { scheduledTime: Date.now(), cron: CRON_UPLOAD_CLEANUP },
      { DB: executor, BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() } },
    );
    expect(send).toHaveBeenCalled();
    expect(executor.query).toHaveBeenCalled();
  });

  it("routes upload cleanup cron to session expiry and purge enqueue", async () => {
    const send = vi.fn(async () => ({}));
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
        return { rows: [{ r2_key: "env/live/ws/a/file.txt" }] };
      }
      return { rows: [] };
    });
    await runScheduledJobs(
      { scheduledTime: Date.now(), cron: CRON_UPLOAD_CLEANUP },
      { DB: executor, BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() } },
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "byte.purge.v1",
        reason: "upload_cleanup",
        upload_session_id: "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      }),
    );
  });

  it("runs hourly discovery sweeps", async () => {
    const executor = createTransactionalSqlExecutor(async () => ({ rows: [] }));
    await runScheduledJobs(
      { scheduledTime: Date.now(), cron: CRON_HOURLY_DISCOVERY },
      { DB: executor, BYTE_PURGE_QUEUE: { send: vi.fn(), sendBatch: vi.fn() } },
    );
    expect(executor.query).toHaveBeenCalled();
  });

  it("purges byte prefixes and acks messages", async () => {
    const deleted: string[][] = [];
    const env: Env = {
      ARTIFACTS: {
        async list() {
          return { objects: [{ key: `artifacts/${artifactId}/file.txt` }], truncated: false };
        },
        async delete(keys) {
          deleted.push(keys);
        },
      },
    };
    const ack = vi.fn();
    await handleQueueBatch(
      {
        queue: QUEUE_BYTE_PURGE,
        messages: [
          {
            body: {
              type: "byte.purge.v1",
              workspace_id: workspaceId,
              artifact_id: artifactId,
              revision_id: revisionId,
              upload_session_id: null,
              prefixes: [`artifacts/${artifactId}/`],
              reason: "deletion",
            },
            ack,
            retry: vi.fn(),
          },
        ],
      },
      env,
    );
    expect(deleted).toEqual([[`artifacts/${artifactId}/file.txt`]]);
    expect(ack).toHaveBeenCalled();
  });

  it("skips safety scans for retained revisions", async () => {
    const executor = createTransactionalSqlExecutor(async () => ({
      rows: [{ status: "retained", artifact_status: "active" }],
    }));
    const ack = vi.fn();
    await handleQueueBatch(
      {
        queue: QUEUE_SAFETY_SCAN,
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
            ack,
            retry: vi.fn(),
          },
        ],
      },
      { DB: executor },
    );
    expect(ack).toHaveBeenCalled();
  });

  it("marks bundle failures from the DLQ consumer", async () => {
    const updates: unknown[] = [];
    const executor = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("insert into idempotency_records")) {
          return { rows: [{ workspace_id: workspaceId }] };
        }
        if (sql.includes("update revisions")) {
          updates.push(sql);
        }
        return { rows: [] };
      }),
      transaction: vi.fn(async (run) => run(executor)),
    };
    const ack = vi.fn();
    await handleQueueBatch(
      {
        queue: `${QUEUE_BUNDLE_GENERATE_DLQ}-preview`,
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
      { DB: executor },
    );
    expect(updates.some((sql) => typeof sql === "string" && sql.includes("bundle_status = 'failed'"))).toBe(true);
    expect(ack).toHaveBeenCalled();
  });

  it("routes bundle-generate preview queue names", async () => {
    const executor = createTransactionalSqlExecutor(async () => ({
      rows: [{ status: "published", artifact_status: "active", bundle_status: "ready" }],
    }));
    const ack = vi.fn();
    await handleQueueBatch(
      {
        queue: `${QUEUE_BUNDLE_GENERATE}-preview`,
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
      { DB: executor },
    );
    expect(ack).toHaveBeenCalled();
  });
});

describe("jobs security headers", () => {
  function expectBaseline(response: Response): void {
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  }

  it("applies the baseline to /healthz and /openapi.json", async () => {
    expectBaseline(await request("/healthz"));
    expectBaseline(await request("/openapi.json"));
  });
});
