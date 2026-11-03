import type { SqlExecutor, SqlValue } from "@agent-paste/db";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CRON_HOURLY_DISCOVERY } from "../constants.js";
import { runScheduledJobs } from "../cron.js";
import type { Env } from "../env.js";
import { applyMigrations, executorForPglite, platformExecutor } from "../test-helpers/pglite.js";
import { LOCKDOWN_RECOVERY_PAGE_SIZE, runLockdownRecoveryDiscovery } from "./lockdown-recovery.js";

const client = new PGlite();
let executor: SqlExecutor;

async function seed(id: string, scope: "artifact" | "workspace", lifted = false) {
  await platformExecutor(executor).query(
    `insert into platform_lockdowns (id, scope, target_id, reason_code, set_at, set_by, lifted_at)
     values ($1, $2, $3, 'abuse', now() - interval '30 days', 'operator', $4)`,
    [id, scope, `target_${id}`, lifted ? new Date().toISOString() : null],
  );
}

beforeAll(async () => {
  await applyMigrations(client);
  executor = executorForPglite(client);
}, 90_000);
afterAll(async () => client.close());
beforeEach(async () => {
  await platformExecutor(executor).query("update platform_lockdowns set lifted_at = now() where lifted_at is null");
});

describe("lockdown recovery discovery under FORCE RLS", () => {
  it("restores missing markers and overwrites preexisting expiring markers for both scopes on the hourly path", async () => {
    await seed("lkd_artifact", "artifact");
    await seed("lkd_workspace", "workspace");
    await seed("lkd_lifted", "artifact", true);
    expect((await executor.query("select id from platform_lockdowns")).rows).toEqual([]);
    const entries = new Map<string, { value: string; expirationTtl?: number }>([
      ["ad:target_lkd_artifact", { value: "old marker", expirationTtl: 604800 }],
    ]);
    const put = vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
      entries.set(key, { value, ...options });
    });
    const send = vi.fn();
    await runScheduledJobs(
      { cron: CRON_HOURLY_DISCOVERY, scheduledTime: Date.now() },
      { DB: executor, DENYLIST: { put }, BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() } },
    );
    expect([...entries.keys()].sort()).toEqual(["ad:target_lkd_artifact", "wsd:target_lkd_workspace"]);
    for (const entry of entries.values()) expect(entry.expirationTtl).toBeUndefined();
    expect(put).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
    const rows = await platformExecutor(executor).query<{ lifted_at: string | null }>(
      "select lifted_at from platform_lockdowns where id = 'lkd_artifact'",
    );
    expect(rows.rows[0]?.lifted_at).toBeNull();
  });

  it("recovers on the hourly cron without a byte-purge queue", async () => {
    await seed("lkd_no_queue", "artifact");
    const put = vi.fn(async () => {});
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runScheduledJobs(
        { cron: CRON_HOURLY_DISCOVERY, scheduledTime: Date.now() },
        { DB: executor, DENYLIST: { put } },
      );
      expect(put).toHaveBeenCalledWith("ad:target_lkd_no_queue", expect.any(String), {});
    } finally {
      log.mockRestore();
    }
  });

  it("visits every page so successful markers cannot starve later lockdowns", async () => {
    await platformExecutor(executor).query(
      `insert into platform_lockdowns (id, scope, target_id, reason_code, set_at, set_by)
       select 'lkd_page_' || lpad(n::text, 4, '0'), 'artifact', 'target_page_' || n, 'abuse', now(), 'operator'
       from generate_series(1, $1::integer) n`,
      [LOCKDOWN_RECOVERY_PAGE_SIZE + 1],
    );
    const put = vi.fn(async () => {});
    const result = await runLockdownRecoveryDiscovery(executor, { DENYLIST: { put } });
    expect(result).toEqual({ discovered: LOCKDOWN_RECOVERY_PAGE_SIZE + 1, restored: LOCKDOWN_RECOVERY_PAGE_SIZE + 1 });
    expect(put).toHaveBeenCalledWith(`ad:target_page_${LOCKDOWN_RECOVERY_PAGE_SIZE + 1}`, expect.any(String), {});
  });

  it("skips a lockdown lifted after discovery before its locked recheck", async () => {
    await seed("lkd_race", "artifact");
    const wrap = (base: SqlExecutor): SqlExecutor => ({
      async query<Row>(sql: string, params?: readonly SqlValue[]) {
        const result = await base.query<Row>(sql, params);
        if (sql.includes("order by id asc")) {
          await base.query("update platform_lockdowns set lifted_at = now() where id = 'lkd_race'");
        }
        return result;
      },
      transaction: (run) => base.transaction((tx) => run(wrap(tx))),
    });
    const put = vi.fn(async () => {});
    expect(await runLockdownRecoveryDiscovery(wrap(executor), { DENYLIST: { put } })).toEqual({
      discovered: 1,
      restored: 0,
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("keeps DB lockdowns and existing markers when KV writes fail, then retries next sweep", async () => {
    await seed("lkd_failure", "artifact");
    await seed("lkd_success", "workspace");
    const entries = new Map([["ad:target_lkd_failure", "existing denial"]]);
    const put = vi.fn(async (key: string, value: string) => {
      if (key.startsWith("ad:")) throw new Error("kv down");
      entries.set(key, value);
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const env: Env = { DENYLIST: { put } };
      expect(await runLockdownRecoveryDiscovery(executor, env)).toEqual({ discovered: 2, restored: 1 });
      expect(entries.get("ad:target_lkd_failure")).toBe("existing denial");
      expect(put.mock.calls.filter(([key]) => key.startsWith("ad:"))).toHaveLength(3);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("cron.lockdown_recovery.lockdown_failed"));
      put.mockImplementation(async (key, value) => {
        entries.set(key, value);
      });
      expect(await runLockdownRecoveryDiscovery(executor, env)).toEqual({ discovered: 2, restored: 2 });
      expect(entries.get("ad:target_lkd_failure")).toContain("platform_lockdown_artifact");
    } finally {
      log.mockRestore();
    }
  });

  it("does no DB work without a denylist binding and propagates DB read failure without KV writes", async () => {
    const put = vi.fn();
    const failing: SqlExecutor = {
      query: vi.fn(),
      transaction: vi.fn(async () => {
        throw new Error("db down");
      }),
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await runLockdownRecoveryDiscovery(failing, {})).toEqual({ discovered: 0, restored: 0 });
      expect(failing.transaction).not.toHaveBeenCalled();
      await expect(runLockdownRecoveryDiscovery(failing, { DENYLIST: { put } })).rejects.toThrow("db down");
      expect(put).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
