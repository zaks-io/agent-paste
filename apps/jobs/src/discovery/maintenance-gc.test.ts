import { describe, expect, it, vi } from "vitest";
import type { AuditEventRow } from "./audit-archive.js";
import { archiveAuditRows, deleteAuditRowsByIds, selectExpiringAuditRows } from "./audit-archive.js";
import { runMaintenanceGc } from "./maintenance-gc.js";
import { createTransactionalSqlExecutor } from "../test-helpers/sql-executor.js";

const sampleAuditRow = (overrides: Partial<AuditEventRow> = {}): AuditEventRow => ({
  id: "evt_01",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  actor_type: "system",
  actor_id: "maintenance_gc",
  action: "artifact.deleted",
  target_type: "artifact",
  target_id: "art_01",
  details: { reason: "retention" },
  request_id: null,
  occurred_at: "2025-12-01T12:00:00.000Z",
  ...overrides,
});

describe("audit archive maintenance GC", () => {
  it("archives expiring audit rows to R2 before deleting them from Postgres", async () => {
    const row = sampleAuditRow();
    const callOrder: string[] = [];
    const put = vi.fn(async () => {
      callOrder.push("put");
    });
    const executor = createTransactionalSqlExecutor(async (sql: string) => {
      if (sql.includes("from operation_events") && sql.trimStart().startsWith("select")) {
        callOrder.push("select");
        return { rows: [row] };
      }
      if (sql.includes("delete from operation_events")) {
        callOrder.push("delete");
        return { rows: [{ id: row.id }] };
      }
      return { rows: [] };
    });

    const result = await runMaintenanceGc(executor, "2026-05-20T00:00:00.000Z", {
      list: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(async () => null),
      put,
    });

    expect(result.discovered).toBe(1);
    expect(callOrder).toEqual(["select", "put", "delete"]);
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^audit\/2025\/12\/01\/[0-9a-f]{16}\.ndjson$/),
      expect.any(Uint8Array),
      expect.objectContaining({ httpMetadata: { contentType: "application/x-ndjson" } }),
    );
    const archivedBody = new TextDecoder().decode(put.mock.calls[0]?.[1] as Uint8Array);
    expect(archivedBody).toContain('"id":"evt_01"');
  });

  it("does not delete audit rows when the R2 write fails", async () => {
    const row = sampleAuditRow();
    const put = vi.fn(async () => {
      throw new Error("r2_write_failed");
    });
    let deleteCalled = false;
    const executor = createTransactionalSqlExecutor(async (sql: string) => {
      if (sql.includes("from operation_events") && sql.trimStart().startsWith("select")) {
        return { rows: [row] };
      }
      if (sql.includes("delete from operation_events")) {
        deleteCalled = true;
        throw new Error("delete_should_not_run");
      }
      return { rows: [] };
    });

    await expect(
      runMaintenanceGc(executor, "2026-05-20T00:00:00.000Z", {
        list: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(async () => null),
        put,
      }),
    ).rejects.toThrow("r2_write_failed");
    expect(put).toHaveBeenCalled();
    expect(deleteCalled).toBe(false);
  });

  it("skips R2 put when the archive object already exists and still deletes rows", async () => {
    const row = sampleAuditRow();
    const put = vi.fn();
    const get = vi.fn(async () => ({ body: new Uint8Array([1, 2, 3]) }));
    const executor = createTransactionalSqlExecutor(async (sql: string) => {
      if (sql.includes("from operation_events") && sql.trimStart().startsWith("select")) {
        return { rows: [row] };
      }
      if (sql.includes("delete from operation_events")) {
        return { rows: [{ id: row.id }] };
      }
      return { rows: [] };
    });

    const result = await runMaintenanceGc(executor, "2026-05-20T00:00:00.000Z", {
      list: vi.fn(),
      delete: vi.fn(),
      get,
      put,
    });

    expect(result.discovered).toBe(1);
    expect(get).toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("does not delete audit rows when the ARTIFACTS binding is missing", async () => {
    const row = sampleAuditRow();
    let deleteCalled = false;
    const executor = createTransactionalSqlExecutor(async (sql: string) => {
      if (sql.includes("from operation_events") && sql.trimStart().startsWith("select")) {
        return { rows: [row] };
      }
      if (sql.includes("delete from operation_events")) {
        deleteCalled = true;
        throw new Error("delete_should_not_run");
      }
      return { rows: [] };
    });

    const result = await runMaintenanceGc(executor, "2026-05-20T00:00:00.000Z");
    expect(result.discovered).toBe(0);
    expect(deleteCalled).toBe(false);
  });
});

describe("audit archive helpers", () => {
  it("writes rows under date partitions derived from occurred_at", async () => {
    const rows = [
      sampleAuditRow({ id: "evt_a", occurred_at: "2025-11-30T23:59:59.000Z" }),
      sampleAuditRow({ id: "evt_b", occurred_at: "2025-12-01T00:00:00.000Z" }),
    ];
    const put = vi.fn(async () => {});
    const archived = await archiveAuditRows(
      { list: vi.fn(), delete: vi.fn(), get: vi.fn(async () => null), put },
      rows,
    );
    expect(archived).toBe(2);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls.map((call) => call[0])).toEqual([
      expect.stringMatching(/^audit\/2025\/11\/30\//),
      expect.stringMatching(/^audit\/2025\/12\/01\//),
    ]);
  });

  it("uses the same archive key for the same batch on re-run", async () => {
    const rows = [sampleAuditRow({ id: "evt_a" }), sampleAuditRow({ id: "evt_b" })];
    const put = vi.fn(async () => {});
    const bucket = { list: vi.fn(), delete: vi.fn(), get: vi.fn(async () => null), put };
    await archiveAuditRows(bucket, rows);
    const firstKey = put.mock.calls[0]?.[0];
    put.mockClear();
    await archiveAuditRows(bucket, rows);
    expect(put.mock.calls[0]?.[0]).toBe(firstKey);
  });

  it("deletes audit rows by id", async () => {
    const executor = createTransactionalSqlExecutor(async () => ({ rows: [{ id: "evt_01" }] }));
    const deleted = await deleteAuditRowsByIds(executor, ["evt_01"]);
    expect(deleted).toBe(1);
    expect(executor.query).toHaveBeenCalledWith(expect.stringContaining("delete from operation_events"), [
      ["evt_01"],
    ]);
  });

  it("selects expiring audit rows in stable order", async () => {
    const executor = createTransactionalSqlExecutor(async () => ({ rows: [sampleAuditRow()] }));
    const rows = await selectExpiringAuditRows(executor, "2026-01-01T00:00:00.000Z", 10);
    expect(rows).toHaveLength(1);
    expect(executor.query).toHaveBeenCalledWith(expect.stringContaining("order by occurred_at asc, id asc"), [
      "2026-01-01T00:00:00.000Z",
      10,
    ]);
  });
});
