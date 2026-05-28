import { describe, expect, it } from "vitest";
import { createNoopBillingProvider } from "./provider.js";
import { runBillingReconciliation } from "./reconcile.js";
import { createTransactionalSqlExecutor } from "./test-helpers/sql-executor.js";

describe("runBillingReconciliation", () => {
  it("returns zero work when there is no local billing state", async () => {
    const executor = createTransactionalSqlExecutor(async (sql) => {
      if (sql.includes("from workspace_billing")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const result = await runBillingReconciliation({
      executor,
      provider: createNoopBillingProvider(),
      now: "2026-05-28T00:00:00.000Z",
    });
    expect(result).toEqual({
      discovered: 0,
      synced: 0,
      drift_events: 0,
      skipped_operator_override: 0,
      cap_hit: false,
    });
  });
});
