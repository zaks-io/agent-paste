import { describe, expect, it } from "vitest";
import {
  cleanupExpired,
  createIdempotencyStore,
  createOperationEvent,
  IdempotencyInFlightError,
  peekIdempotentReplay,
  runCommand,
  runIdempotent,
  type SqlExecutor,
  type SqlQueryResult,
  type SqlValue,
} from "./index";

class MockExecutor implements SqlExecutor {
  readonly calls: Array<{ sql: string; params: readonly SqlValue[] }> = [];
  constructor(private readonly handler: (sql: string, params: readonly SqlValue[]) => SqlQueryResult) {}
  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ sql, params });
    return this.handler(sql, params) as SqlQueryResult<Row>;
  }
  async transaction<T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return run(this);
  }
}

const actor = { type: "api_key" as const, id: "ak_1", workspaceId: "ws_1" };

describe("command helpers", () => {
  it("creates operation events", () => {
    expect(
      createOperationEvent({
        operationId: "op_1",
        type: "artifact.write",
        status: "succeeded",
        now: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toMatchObject({
      id: "op_1:artifact.write:2026-01-01T00:00:00.000Z",
      operationId: "op_1",
      status: "succeeded",
    });
  });

  it("reuses idempotent results for matching fingerprints", () => {
    const store = createIdempotencyStore<number>();
    let runs = 0;
    const first = runIdempotent(store, { key: "k", fingerprint: "f", run: () => (runs += 1) });
    const second = runIdempotent(store, { key: "k", fingerprint: "f", run: () => (runs += 1) });

    expect(first).toEqual({ hit: false, value: 1 });
    expect(second).toEqual({ hit: true, value: 1 });
  });

  it("cleans up expired items", () => {
    expect(
      cleanupExpired(
        [{ id: "old", expiresAt: "2026-01-01T00:00:00.000Z" }, { id: "fresh" }],
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toEqual({
      removed: [{ id: "old", expiresAt: "2026-01-01T00:00:00.000Z" }],
      retained: [{ id: "fresh" }],
    });
  });

  describe("runCommand", () => {
    it("executes handler and inserts audit on first run", async () => {
      const executor = new MockExecutor((sql) => {
        if (sql.includes("insert into idempotency_records")) {
          return { rows: [{ workspace_id: "ws_1" }] };
        }
        return { rows: [] };
      });

      const result = await runCommand({
        actor,
        operation: "artifact.create",
        idempotencyKey: "key_1",
        executor,
        handler: async () => ({
          result: { id: "artifact_1" },
          audit: [
            {
              action: "artifact.create",
              targetType: "artifact",
              targetId: "artifact_1",
            },
          ],
        }),
      });

      expect(result.isReplay).toBe(false);
      expect(result.result).toEqual({ id: "artifact_1" });

      const ops = executor.calls.map((c) => c.sql);
      expect(ops.some((sql) => sql.includes("insert into idempotency_records"))).toBe(true);
      expect(ops.some((sql) => sql.includes("update idempotency_records"))).toBe(true);
      expect(ops.some((sql) => sql.includes("insert into operation_events"))).toBe(true);
    });

    it("returns cached result on replay without calling handler", async () => {
      const cachedResult = { id: "artifact_1" };
      const executor = new MockExecutor((sql) => {
        if (sql.includes("insert into idempotency_records")) {
          return { rows: [] };
        }
        if (sql.includes("select status, result_json")) {
          return {
            rows: [
              {
                status: "completed",
                result_json: cachedResult,
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ],
          };
        }
        return { rows: [] };
      });

      const result = await runCommand({
        actor,
        operation: "artifact.create",
        idempotencyKey: "key_1",
        executor,
        handler: async () => {
          throw new Error("handler should not be called on replay");
        },
      });

      expect(result.isReplay).toBe(true);
      expect(result.result).toEqual(cachedResult);
    });

    it("throws IdempotencyInFlightError on fresh duplicate", async () => {
      const now = "2026-01-01T00:00:00.000Z";
      const executor = new MockExecutor((sql) => {
        if (sql.includes("insert into idempotency_records")) {
          return { rows: [] };
        }
        if (sql.includes("select status, result_json")) {
          return {
            rows: [
              {
                status: "in_flight",
                result_json: null,
                created_at: now,
              },
            ],
          };
        }
        return { rows: [] };
      });

      await expect(
        runCommand({
          actor,
          operation: "artifact.create",
          idempotencyKey: "key_1",
          now,
          executor,
          handler: async () => ({ result: { id: "artifact_1" } }),
        }),
      ).rejects.toThrow(IdempotencyInFlightError);
    });

    it("takes over stale in-flight records and runs handler", async () => {
      const executor = new MockExecutor((sql) => {
        if (sql.includes("insert into idempotency_records")) {
          return { rows: [] };
        }
        if (sql.includes("select status, result_json")) {
          return {
            rows: [
              {
                status: "in_flight",
                result_json: null,
                created_at: "2020-01-01T00:00:00.000Z",
              },
            ],
          };
        }
        return { rows: [] };
      });

      const result = await runCommand({
        actor,
        operation: "artifact.create",
        idempotencyKey: "key_1",
        executor,
        handler: async () => ({ result: { id: "artifact_1" } }),
      });

      expect(result.isReplay).toBe(false);
      expect(result.result).toEqual({ id: "artifact_1" });
    });

    it("peekIdempotentReplay returns cached result for completed records", async () => {
      const cachedResult = { id: "artifact_1" };
      const executor = new MockExecutor(() => ({
        rows: [{ status: "completed", result_json: cachedResult }],
      }));

      const hit = await peekIdempotentReplay<{ id: string }>({
        executor,
        actor,
        operation: "artifact.create",
        idempotencyKey: "key_1",
      });

      expect(hit).toEqual({ result: cachedResult });
      expect(executor.calls).toHaveLength(1);
      expect(executor.calls[0]?.sql).toContain("select status, result_json");
    });

    it("peekIdempotentReplay returns null for in-flight or missing records", async () => {
      const inFlight = new MockExecutor(() => ({
        rows: [{ status: "in_flight", result_json: null }],
      }));
      const empty = new MockExecutor(() => ({ rows: [] }));

      await expect(
        peekIdempotentReplay({ executor: inFlight, actor, operation: "x", idempotencyKey: "k" }),
      ).resolves.toBeNull();
      await expect(
        peekIdempotentReplay({ executor: empty, actor, operation: "x", idempotencyKey: "k" }),
      ).resolves.toBeNull();
    });

    it("supports admin operations with null workspace_id", async () => {
      const executor = new MockExecutor((sql) => {
        if (sql.includes("insert into idempotency_records")) {
          return { rows: [{ workspace_id: null }] };
        }
        return { rows: [] };
      });

      const adminActor = { type: "admin" as const, id: "admin", workspaceId: null };
      const result = await runCommand({
        actor: adminActor,
        operation: "admin.workspace.create",
        idempotencyKey: "key_1",
        executor,
        handler: async () => ({ result: { id: "ws_new" } }),
      });

      expect(result.isReplay).toBe(false);
      expect(result.result).toEqual({ id: "ws_new" });

      const claim = executor.calls.find((c) => c.sql.includes("insert into idempotency_records"));
      expect(claim?.params[0]).toBeNull();
    });
  });
});
