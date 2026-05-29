import { describe, expect, it, vi } from "vitest";
import { CRON_BILLING_RECONCILE } from "../constants.js";
import { runScheduledJobs } from "../cron.js";
import { createTransactionalSqlExecutor } from "../test-helpers/sql-executor.js";
import { runBillingReconcileDiscovery } from "./billing-reconcile.js";

describe("billing reconcile discovery", () => {
  it("skips when billing is disabled", async () => {
    const executor = createTransactionalSqlExecutor(async () => ({ rows: [] }));
    const result = await runBillingReconcileDiscovery(executor, {}, "2026-05-29T06:00:00.000Z");
    expect(result).toEqual({ discovered: 0, enqueued: 0, cap_hit: false });
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("runs reconciliation with the noop provider when billing is enabled", async () => {
    const executor = createTransactionalSqlExecutor(async () => ({ rows: [] }));
    const result = await runBillingReconcileDiscovery(
      executor,
      { BILLING_ENABLED: "true" },
      "2026-05-29T06:00:00.000Z",
    );
    expect(result).toEqual({ discovered: 0, enqueued: 0, cap_hit: false });
    expect(executor.query).toHaveBeenCalled();
  });

  it("returns zero work when reconciliation throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const executor = createTransactionalSqlExecutor(async () => {
      throw new Error("reconcile_db_failed");
    });
    const result = await runBillingReconcileDiscovery(
      executor,
      { BILLING_ENABLED: "true" },
      "2026-05-29T06:00:00.000Z",
    );
    expect(result).toEqual({ discovered: 0, enqueued: 0, cap_hit: false });
    expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("cron.billing_reconcile.failed"))).toBe(true);
    errorSpy.mockRestore();
  });

  it("stringifies non-Error reconciliation failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const executor = createTransactionalSqlExecutor(async () => {
      throw "reconcile_failed";
    });
    await runBillingReconcileDiscovery(executor, { BILLING_ENABLED: "true" }, "2026-05-29T06:00:00.000Z");
    expect(
      errorSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes("cron.billing_reconcile.failed") && String(call[0]).includes("reconcile_failed"),
      ),
    ).toBe(true);
    errorSpy.mockRestore();
  });

  it("routes the daily billing cron schedule", async () => {
    const executor = createTransactionalSqlExecutor(async () => ({ rows: [] }));
    await runScheduledJobs(
      { scheduledTime: Date.parse("2026-05-29T06:00:00.000Z"), cron: CRON_BILLING_RECONCILE },
      { DB: executor, BILLING_ENABLED: "true" },
    );
    expect(executor.query).toHaveBeenCalled();
  });
});
