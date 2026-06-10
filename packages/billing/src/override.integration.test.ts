import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { setWorkspacePlanOverride } from "./override.js";
import { applyBillingSnapshot, loadLocalBillingRow } from "./sync.js";
import { applyMigrations, executorForPglite, platformExecutor, workspaceExecutor } from "./test-helpers/pglite.js";

const workspaceId = "55555555-5555-5555-5555-555555555555";

describe("setWorkspacePlanOverride", () => {
  let baseExecutor: ReturnType<typeof executorForPglite>;

  beforeAll(async () => {
    const client = new PGlite();
    await applyMigrations(client);
    baseExecutor = executorForPglite(client);
    await platformExecutor(baseExecutor).query(
      `insert into workspaces (id, name, contact_email, plan, created_at, updated_at)
       values ($1, 'override', 'o@example.com', 'free', now(), now())`,
      [workspaceId],
    );
  }, 90_000);

  it("sets the plan and stamps the override timestamp with an audit event", async () => {
    const executor = workspaceExecutor(baseExecutor, workspaceId);
    const result = await setWorkspacePlanOverride({
      executor,
      actorId: "operator@example.com",
      workspaceId,
      plan: "pro",
      idempotencyKey: "override-1",
      now: "2026-06-04T00:00:00.000Z",
    });
    expect(result).toEqual({ plan: "pro", operator_override: true, plan_changed: true });

    const row = await loadLocalBillingRow(executor, workspaceId);
    expect(row?.plan).toBe("pro");
    expect(row?.plan_operator_override_at).not.toBeNull();

    const audit = await platformExecutor(baseExecutor).query<{ action: string; details: Record<string, unknown> }>(
      `select action, details from operation_events where workspace_id = $1 and action = 'workspace.plan.updated'`,
      [workspaceId],
    );
    expect(audit.rows[0]?.details).toMatchObject({ source: "operator_override", plan: "pro" });
  });

  it("is an idempotent no-op on replay", async () => {
    const executor = workspaceExecutor(baseExecutor, workspaceId);
    const replay = await setWorkspacePlanOverride({
      executor,
      actorId: "operator@example.com",
      workspaceId,
      plan: "pro",
      idempotencyKey: "override-1",
      now: "2026-06-04T01:00:00.000Z",
    });
    expect(replay).toEqual({ plan: "pro", operator_override: true, plan_changed: true });
  });

  it("preserves the override against a later canceled webhook snapshot", async () => {
    const executor = workspaceExecutor(baseExecutor, workspaceId);
    const applied = await applyBillingSnapshot({
      executor,
      actorId: "stripe_webhook",
      workspaceId,
      snapshot: {
        workspaceId,
        stripeCustomerId: "cus_o",
        stripeSubscriptionId: "sub_o",
        status: "canceled",
        currentPeriodEnd: null,
        priceInterval: null,
      },
      now: "2026-06-05T00:00:00.000Z",
    });
    expect(applied).toMatchObject({ skipped_operator_override: true, plan: "pro" });

    const row = await loadLocalBillingRow(executor, workspaceId);
    expect(row?.plan).toBe("pro");
  });

  it("throws when the workspace does not exist", async () => {
    const missing = "66666666-6666-6666-6666-666666666666";
    await expect(
      setWorkspacePlanOverride({
        executor: workspaceExecutor(baseExecutor, missing),
        actorId: "operator@example.com",
        workspaceId: missing,
        plan: "pro",
        idempotencyKey: "override-missing",
        now: "2026-06-04T02:00:00.000Z",
      }),
    ).rejects.toThrow("workspace_not_found");
  });

  it("clears the override so Stripe state resumes control", async () => {
    const executor = workspaceExecutor(baseExecutor, workspaceId);
    const cleared = await setWorkspacePlanOverride({
      executor,
      actorId: "operator@example.com",
      workspaceId,
      plan: null,
      idempotencyKey: "override-clear",
      now: "2026-06-06T00:00:00.000Z",
    });
    expect(cleared).toEqual({ plan: "pro", operator_override: false, plan_changed: false });

    const row = await loadLocalBillingRow(executor, workspaceId);
    expect(row?.plan_operator_override_at).toBeNull();

    // With the override cleared, the SAME (subscription, status, period end) snapshot the
    // override previously blocked must execute again — a cached completion here would
    // leave the workspace stranded on the override-era plan forever.
    const applied = await applyBillingSnapshot({
      executor,
      actorId: "stripe_webhook",
      workspaceId,
      snapshot: {
        workspaceId,
        stripeCustomerId: "cus_o",
        stripeSubscriptionId: "sub_o",
        status: "canceled",
        currentPeriodEnd: null,
        priceInterval: null,
      },
      now: "2026-06-06T01:00:00.000Z",
    });
    expect(applied).toMatchObject({ applied: true, replayed: false, plan: "free" });

    const after = await loadLocalBillingRow(executor, workspaceId);
    expect(after?.plan).toBe("free");
  });

  it("resumes pro from Stripe after an override round-trip with an unchanged snapshot", async () => {
    const lifecycleWorkspaceId = "77777777-7777-7777-7777-777777777777";
    await platformExecutor(baseExecutor).query(
      `insert into workspaces (id, name, contact_email, plan, created_at, updated_at)
       values ($1, 'lifecycle', 'l@example.com', 'free', now(), now())`,
      [lifecycleWorkspaceId],
    );
    const executor = workspaceExecutor(baseExecutor, lifecycleWorkspaceId);
    const activeSnapshot = {
      workspaceId: lifecycleWorkspaceId,
      stripeCustomerId: "cus_lifecycle",
      stripeSubscriptionId: "sub_lifecycle",
      status: "active" as const,
      currentPeriodEnd: "2026-07-01T00:00:00.000Z",
      priceInterval: "month" as const,
    };

    const activated = await applyBillingSnapshot({
      executor,
      actorId: "stripe_webhook",
      workspaceId: lifecycleWorkspaceId,
      snapshot: activeSnapshot,
      now: "2026-06-07T00:00:00.000Z",
    });
    expect(activated).toMatchObject({ applied: true, plan: "pro" });

    await setWorkspacePlanOverride({
      executor,
      actorId: "operator@example.com",
      workspaceId: lifecycleWorkspaceId,
      plan: "free",
      idempotencyKey: "lifecycle-set",
      now: "2026-06-07T01:00:00.000Z",
    });
    const blocked = await applyBillingSnapshot({
      executor,
      actorId: "billing_reconcile",
      workspaceId: lifecycleWorkspaceId,
      snapshot: activeSnapshot,
      now: "2026-06-07T02:00:00.000Z",
    });
    expect(blocked).toMatchObject({ skipped_operator_override: true, plan: "free" });

    await setWorkspacePlanOverride({
      executor,
      actorId: "operator@example.com",
      workspaceId: lifecycleWorkspaceId,
      plan: null,
      idempotencyKey: "lifecycle-clear",
      now: "2026-06-07T03:00:00.000Z",
    });

    // Unchanged (status, period end) on the next reconcile pass must re-apply Stripe state.
    const resumed = await applyBillingSnapshot({
      executor,
      actorId: "billing_reconcile",
      workspaceId: lifecycleWorkspaceId,
      snapshot: activeSnapshot,
      now: "2026-06-07T04:00:00.000Z",
    });
    expect(resumed).toMatchObject({ applied: true, replayed: false, plan: "pro", plan_changed: true });

    const row = await loadLocalBillingRow(executor, lifecycleWorkspaceId);
    expect(row).toMatchObject({ plan: "pro", subscription_status: "active", plan_operator_override_at: null });
  });
});
