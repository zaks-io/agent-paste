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
