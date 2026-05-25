import { describe, expect, it, vi } from "vitest";
import { bindDrizzleToExecutor, type DrizzleDb } from "../postgres/drizzle.js";
import type { SqlExecutor } from "../types.js";

const commandState = vi.hoisted(() => ({
  runCommand: vi.fn(),
  peekIdempotentReplay: vi.fn(),
}));

vi.mock("@agent-paste/commands", () => ({
  runCommand: commandState.runCommand,
  peekIdempotentReplay: commandState.peekIdempotentReplay,
}));

import type { CommandSpec } from "./ports.js";
import { PostgresUnitOfWork } from "./postgres-unit-of-work.js";

describe("PostgresUnitOfWork", () => {
  it("requires raw executors to have a bound Drizzle instance", () => {
    expect(() => new PostgresUnitOfWork(sqlExecutor({ drizzle: null }))).toThrow("executor_missing_drizzle_binding");
  });

  it("runs reads inside the requested RLS scope", async () => {
    const drizzle = {} as DrizzleDb;
    const sql = sqlExecutor({ drizzle });
    const uow = new PostgresUnitOfWork({
      sql,
      drizzle,
      async transaction(run) {
        return run({ sql, drizzle, transaction: this.transaction });
      },
    });

    await expect(uow.read({ kind: "workspace", workspaceId: "workspace_1" }, async () => "ok")).resolves.toBe("ok");

    expect(sql.queries).toEqual([
      ["select set_config('app.workspace_id', $1, true)", ["workspace_1"]],
      ["select set_config('app.platform', '', true)", []],
    ]);
  });

  it("passes scoped executors through command and replay paths", async () => {
    const drizzle = {} as DrizzleDb;
    const sql = sqlExecutor({ drizzle });
    const uow = new PostgresUnitOfWork({
      sql,
      drizzle,
      async transaction(run) {
        return run({ sql, drizzle, transaction: this.transaction });
      },
    });
    const spec: CommandSpec = {
      actor: { type: "api_key", id: "actor_1", workspaceId: "workspace_1" },
      operation: "test.operation",
      idempotencyKey: "idem_1",
      scope: { kind: "workspace", workspaceId: "workspace_1" },
      now: "2026-01-01T00:00:00.000Z",
    };
    commandState.runCommand.mockImplementationOnce(async ({ handler }) => handler(sql));
    commandState.runCommand.mockImplementationOnce(async ({ handler }) => handler(sql));
    commandState.peekIdempotentReplay.mockResolvedValueOnce({ result: "replayed" });

    await expect(
      uow.command(spec, async (_entities, ctx) =>
        ctx.command({ ...spec, operation: "nested.operation" }, async () => "done"),
      ),
    ).resolves.toBe("done");
    await expect(
      uow.peekReplay<string>({
        actor: spec.actor,
        operation: spec.operation,
        idempotencyKey: spec.idempotencyKey,
        scope: spec.scope,
      }),
    ).resolves.toEqual({ result: "replayed" });

    expect(commandState.runCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({ workspaceId: "workspace_1" }));
    expect(commandState.runCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ operation: "nested.operation" }),
    );
    expect(commandState.peekIdempotentReplay).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace_1" }),
    );
  });
});

function sqlExecutor(input: { drizzle: DrizzleDb | null }) {
  const queries: Array<[string, readonly unknown[]]> = [];
  const executor: SqlExecutor & { queries: Array<[string, readonly unknown[]]> } = {
    queries,
    async query(query, params = []) {
      queries.push([query, params]);
      return { rows: [] };
    },
    async transaction(run) {
      const tx: SqlExecutor = {
        async query(query, params = []) {
          queries.push([query, params]);
          return { rows: [] };
        },
        async transaction(nested) {
          return nested(tx);
        },
      };
      if (input.drizzle) {
        bindDrizzleToExecutor(tx, input.drizzle);
      }
      return run(tx);
    },
  };
  if (input.drizzle) {
    bindDrizzleToExecutor(executor, input.drizzle);
  }
  return executor;
}
