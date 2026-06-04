import { describe, expect, it, vi } from "vitest";
import { applyMaliciousUrlLockdown } from "./platform-lockdown.js";

describe("applyMaliciousUrlLockdown", () => {
  it("writes the artifact denylist after creating a lockdown", async () => {
    const put = vi.fn(async () => {});
    const executor = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from platform_lockdowns")) {
          return { rows: [] };
        }
        if (sql.includes("insert into platform_lockdowns")) {
          return { rows: [{ id: "lkd_test" }] };
        }
        if (sql.includes("insert into operation_events")) {
          return { rows: [] };
        }
        if (sql.includes("idempotency_records")) {
          return { rows: [{ workspace_id: null }] };
        }
        return { rows: [] };
      }),
      transaction: vi.fn(async (handler: (tx: typeof executor) => Promise<unknown>) => handler(executor)),
    };

    await expect(
      applyMaliciousUrlLockdown(
        executor,
        { DENYLIST: { put } },
        {
          workspaceId: "00000000-0000-4000-8000-000000000001",
          artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          now: "2026-05-20T00:00:00.000Z",
        },
      ),
    ).resolves.toBe(true);
    expect(put).toHaveBeenCalledWith(
      "ad:art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });

  it("defaults the audit source and idempotency key to the URL scanner", async () => {
    const captured = captureLockdown();
    await applyMaliciousUrlLockdown(captured.executor, { DENYLIST: { put: vi.fn(async () => {}) } }, lockdownInput());
    expect(captured.idempotencyKey()).toBe("url_scanner:art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9");
    expect(captured.auditSource()).toBe("url_scanner");
  });

  it("uses a distinct audit source and idempotency key for the hash-reputation source", async () => {
    const captured = captureLockdown();
    await applyMaliciousUrlLockdown(captured.executor, { DENYLIST: { put: vi.fn(async () => {}) } }, lockdownInput(), {
      source: "hash_reputation",
      idempotencyKeyPrefix: "hash_reputation",
    });
    expect(captured.idempotencyKey()).toBe("hash_reputation:art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9");
    expect(captured.auditSource()).toBe("hash_reputation");
    expect(captured.idempotencyKey()).not.toBe("url_scanner:art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9");
  });

  it("skips insert when an effective lockdown already exists", async () => {
    const executor = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from platform_lockdowns")) {
          return { rows: [{ id: "lkd_existing" }] };
        }
        if (sql.includes("idempotency_records")) {
          return { rows: [{ workspace_id: null }] };
        }
        return { rows: [] };
      }),
      transaction: vi.fn(async (handler: (tx: typeof executor) => Promise<unknown>) => handler(executor)),
    };

    await expect(
      applyMaliciousUrlLockdown(
        executor,
        {},
        {
          workspaceId: "00000000-0000-4000-8000-000000000001",
          artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          now: "2026-05-20T00:00:00.000Z",
        },
      ),
    ).resolves.toBe(false);
  });
});

function lockdownInput() {
  return {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    now: "2026-05-20T00:00:00.000Z",
  };
}

function captureLockdown() {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const executor = {
    query: vi.fn(async (sql: string, params: readonly unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("from platform_lockdowns")) {
        return { rows: [] };
      }
      if (sql.includes("insert into platform_lockdowns")) {
        return { rows: [{ id: "lkd_test" }] };
      }
      if (sql.includes("idempotency_records")) {
        return { rows: [{ workspace_id: null }] };
      }
      return { rows: [] };
    }),
    transaction: vi.fn(async (handler: (tx: typeof executor) => Promise<unknown>) => handler(executor)),
  };
  return {
    executor,
    idempotencyKey: () =>
      String(calls.find((call) => call.sql.includes("insert into idempotency_records"))?.params[4] ?? ""),
    auditSource: () => {
      const event = calls.find((call) => call.sql.includes("insert into operation_events"));
      return (JSON.parse(String(event?.params[4] ?? "{}")) as { source?: string }).source ?? "";
    },
  };
}
