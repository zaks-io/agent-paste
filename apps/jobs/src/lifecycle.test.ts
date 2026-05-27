import { describe, expect, it, vi } from "vitest";
import { AUTO_DELETION_SWEEP_CAP, RETENTION_SWEEP_CAP } from "./constants.js";
import { runAutoDeletionDiscovery } from "./discovery/auto-deletion.js";
import { runRetentionDiscovery } from "./discovery/retention.js";
import { runPurgeRecoveryDiscovery } from "./discovery/purge-recovery.js";
import { enqueueArtifactBytePurge } from "./lifecycle/byte-purge-enqueue.js";
import { writeArtifactDenylist } from "./lifecycle/denylist.js";
import { applyArtifactPurgeSideEffects } from "./lifecycle/purge-side-effects.js";
import { createTransactionalSqlExecutor } from "./test-helpers/sql-executor.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

function mockExecutor(run: (sql: string) => Promise<{ rows: unknown[] }>) {
  return createTransactionalSqlExecutor(run);
}

describe("lifecycle side effects", () => {
  it("skips byte purge enqueue when denylist writes fail", async () => {
    const send = vi.fn();
    const executor = { query: vi.fn(), transaction: vi.fn() };
    const result = await applyArtifactPurgeSideEffects(
      {
        DENYLIST: {
          put: vi.fn(async () => {
            throw new Error("kv_unavailable");
          }),
        },
        BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() },
      },
      executor,
      { workspaceId, artifactId, revisionId, reason: "deletion" },
    );
    expect(result).toEqual({ denylistWritten: false, enqueued: false });
    expect(send).not.toHaveBeenCalled();
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("retries denylist writes before giving up", async () => {
    let attempts = 0;
    const put = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("kv_flaky");
      }
    });
    await expect(writeArtifactDenylist({ DENYLIST: { put } }, artifactId)).resolves.toBe(true);
    expect(put).toHaveBeenCalledTimes(3);
  });

  it("returns false when denylist writes keep failing", async () => {
    const put = vi.fn(async () => {
      throw new Error("kv_down");
    });
    await expect(writeArtifactDenylist({ DENYLIST: { put } }, artifactId)).resolves.toBe(false);
    expect(put).toHaveBeenCalledTimes(3);
  });

  it("returns false when denylist binding or artifact id is missing", async () => {
    await expect(writeArtifactDenylist({}, artifactId)).resolves.toBe(false);
    await expect(writeArtifactDenylist({ DENYLIST: { put: vi.fn() } }, "")).resolves.toBe(false);
  });

  it("marks bytes_purge_enqueued_at after enqueue succeeds", async () => {
    const send = vi.fn(async () => ({}));
    const executor = {
      query: vi.fn(async () => ({ rows: [{ id: revisionId }] })),
      transaction: vi.fn(),
    };
    await expect(
      enqueueArtifactBytePurge({ BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() } }, executor, {
        workspaceId,
        artifactId,
        revisionId,
        reason: "deletion",
      }),
    ).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "byte.purge.v1",
        artifact_id: artifactId,
        prefixes: [`artifacts/${artifactId}/`],
      }),
    );
    expect(executor.query).toHaveBeenCalledWith(expect.stringContaining("bytes_purge_enqueued_at"), [
      workspaceId,
      revisionId,
      artifactId,
    ]);
  });

  it("returns false when revision bookkeeping updates zero rows", async () => {
    const send = vi.fn(async () => ({}));
    const executor = {
      query: vi.fn(async () => ({ rows: [] })),
      transaction: vi.fn(),
    };
    await expect(
      enqueueArtifactBytePurge({ BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() } }, executor, {
        workspaceId,
        artifactId,
        revisionId,
        reason: "deletion",
      }),
    ).resolves.toBe(false);
    expect(send).toHaveBeenCalled();
  });

  it("returns false when the purge queue binding is missing", async () => {
    const executor = { query: vi.fn(), transaction: vi.fn() };
    await expect(
      enqueueArtifactBytePurge({}, executor, {
        workspaceId,
        artifactId,
        revisionId,
        reason: "deletion",
      }),
    ).resolves.toBe(false);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("returns false when queue send fails", async () => {
    const send = vi.fn(async () => {
      throw new Error("queue_full");
    });
    const executor = { query: vi.fn(), transaction: vi.fn() };
    await expect(
      enqueueArtifactBytePurge({ BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() } }, executor, {
        workspaceId,
        artifactId,
        revisionId,
        reason: "deletion",
      }),
    ).resolves.toBe(false);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("drains byte purge synchronously when smoke sync is enabled", async () => {
    const send = vi.fn(async () => ({}));
    const r2Key = `artifacts/${artifactId}/revisions/${revisionId}/files/index.html`;
    const deleted: string[][] = [];
    const executor = {
      query: vi.fn(async () => ({ rows: [{ id: revisionId }] })),
      transaction: vi.fn(),
    };
    await expect(
      enqueueArtifactBytePurge(
        {
          BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() },
          SMOKE_SYNC_BYTE_PURGE: "true",
          AGENT_PASTE_ENV: "preview",
          ARTIFACTS: {
            async list({ prefix }: { prefix: string }) {
              if (prefix === `artifacts/${artifactId}/`) {
                return { objects: [{ key: r2Key }], truncated: false };
              }
              return { objects: [], truncated: false };
            },
            async delete(keys: string[]) {
              deleted.push(keys);
            },
          },
        },
        executor,
        {
          workspaceId,
          artifactId,
          revisionId,
          reason: "deletion",
        },
      ),
    ).resolves.toBe(true);
    expect(send).toHaveBeenCalled();
    expect(deleted).toEqual([[r2Key]]);
    expect(executor.query).toHaveBeenCalled();
  });
});

describe("retention discovery", () => {
  it("returns zero enqueued when the purge queue binding is missing", async () => {
    const executor = { query: vi.fn(), transaction: vi.fn() };
    const result = await runRetentionDiscovery(executor, {}, "2026-05-20T00:00:00.000Z");
    expect(result).toEqual({ discovered: 0, enqueued: 0, cap_hit: false });
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("returns zero enqueued when no revisions qualify for retention", async () => {
    const executor = createTransactionalSqlExecutor(async () => ({ rows: [] }));
    const env = {
      BYTE_PURGE_QUEUE: { send: vi.fn(), sendBatch: vi.fn() },
      DENYLIST: { put: vi.fn(async () => {}) },
    };
    const result = await runRetentionDiscovery(executor, env, "2026-05-20T00:00:00.000Z");
    expect(result).toEqual({ discovered: 0, enqueued: 0, cap_hit: false });
  });

  it("retains revisions and enqueues revision-scoped purge work", async () => {
    const oldRevisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0";
    const send = vi.fn(async () => ({}));
    const put = vi.fn(async () => {});
    let discovery = true;
    const executor = mockExecutor(async (sql) => {
      if (discovery && sql.includes("from revisions")) {
        discovery = false;
        return {
          rows: [{ id: oldRevisionId, workspace_id: workspaceId, artifact_id: artifactId }],
        };
      }
      if (sql.includes("insert into idempotency_records")) {
        return { rows: [{ workspace_id: workspaceId }] };
      }
      if (sql.includes("update revisions")) {
        return { rows: [{ id: oldRevisionId }] };
      }
      if (sql.includes("bytes_purge_enqueued_at")) {
        return { rows: [{ id: oldRevisionId }] };
      }
      return { rows: [] };
    });
    const env = {
      BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() },
      DENYLIST: { put },
    };
    const result = await runRetentionDiscovery(executor, env, "2026-05-20T00:00:00.000Z");
    expect(result).toMatchObject({ discovered: 1, enqueued: 1, cap_hit: false });
    expect(put).toHaveBeenCalledWith(`rd:${oldRevisionId}`, expect.any(String), expect.any(Object));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        revision_id: oldRevisionId,
        reason: "retention",
        prefixes: [`artifacts/${artifactId}/revisions/${oldRevisionId}/`],
      }),
    );
  });

  it("replays runCommand without re-enqueueing retention purge work", async () => {
    const oldRevisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0";
    const send = vi.fn(async () => ({}));
    let discovery = true;
    const executor = mockExecutor(async (sql) => {
      if (discovery && sql.includes("from revisions")) {
        discovery = false;
        return {
          rows: [{ id: oldRevisionId, workspace_id: workspaceId, artifact_id: artifactId }],
        };
      }
      if (sql.includes("insert into idempotency_records")) {
        return { rows: [] };
      }
      if (sql.includes("select status, result_json")) {
        return {
          rows: [
            {
              status: "completed",
              result_json: { revision_id: oldRevisionId, retained: true },
              created_at: "2026-05-20T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });
    const env = {
      BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() },
      DENYLIST: { put: vi.fn(async () => {}) },
    };
    const result = await runRetentionDiscovery(executor, env, "2026-05-20T00:00:00.000Z");
    expect(result.enqueued).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports cap_hit when more revisions qualify than the sweep cap", async () => {
    const rows = Array.from({ length: RETENTION_SWEEP_CAP + 1 }, (_, index) => ({
      id: `rev_${String(index).padStart(26, "0")}`,
      workspace_id: workspaceId,
      artifact_id: artifactId,
    }));
    const executor = createTransactionalSqlExecutor(async () => ({ rows }));
    const env = {
      BYTE_PURGE_QUEUE: { send: vi.fn(), sendBatch: vi.fn() },
      DENYLIST: { put: vi.fn(async () => {}) },
    };
    const result = await runRetentionDiscovery(executor, env, "2026-05-20T00:00:00.000Z");
    expect(result).toMatchObject({
      discovered: RETENTION_SWEEP_CAP,
      cap_hit: true,
    });
  });

  it("skips enqueue when retention update does not retain the revision", async () => {
    const oldRevisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0";
    const send = vi.fn(async () => ({}));
    let discovery = true;
    const executor = mockExecutor(async (sql) => {
      if (discovery && sql.includes("from revisions")) {
        discovery = false;
        return {
          rows: [{ id: oldRevisionId, workspace_id: workspaceId, artifact_id: artifactId }],
        };
      }
      if (sql.includes("insert into idempotency_records")) {
        return { rows: [{ workspace_id: workspaceId }] };
      }
      if (sql.includes("update revisions")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const env = {
      BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() },
      DENYLIST: { put: vi.fn(async () => {}) },
    };
    const result = await runRetentionDiscovery(executor, env, "2026-05-20T00:00:00.000Z");
    expect(result).toMatchObject({ discovered: 1, enqueued: 0, cap_hit: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("continues retention when one revision command throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const runCommand = vi.spyOn(await import("@agent-paste/commands"), "runCommand");
    runCommand.mockRejectedValueOnce(new Error("retention_tx_failed"));
    try {
      const oldRevisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0";
      let discovery = true;
      const executor = mockExecutor(async (sql) => {
        if (discovery && sql.includes("from revisions")) {
          discovery = false;
          return {
            rows: [{ id: oldRevisionId, workspace_id: workspaceId, artifact_id: artifactId }],
          };
        }
        return { rows: [] };
      });
      const env = {
        BYTE_PURGE_QUEUE: { send: vi.fn(), sendBatch: vi.fn() },
        DENYLIST: { put: vi.fn(async () => {}) },
      };
      const result = await runRetentionDiscovery(executor, env, "2026-05-20T00:00:00.000Z");
      expect(result).toMatchObject({ discovered: 1, enqueued: 0, cap_hit: false });
      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("cron.retention.revision_failed"))).toBe(
        true,
      );
    } finally {
      runCommand.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("auto deletion discovery", () => {
  it("returns zero enqueued when the purge queue binding is missing", async () => {
    const executor = { query: vi.fn(), transaction: vi.fn() };
    const result = await runAutoDeletionDiscovery(executor, {}, "2026-05-20T00:00:00.000Z");
    expect(result).toEqual({ discovered: 0, enqueued: 0, cap_hit: false });
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("expires artifacts and enqueues purge work through runCommand", async () => {
    const send = vi.fn(async () => ({}));
    let discovery = true;
    const executor = mockExecutor(async (sql) => {
      if (discovery && sql.includes("from artifacts")) {
        discovery = false;
        expect(sql).toContain("pinned_at is null");
        return { rows: [{ id: artifactId, workspace_id: workspaceId, revision_id: revisionId }] };
      }
      if (sql.includes("insert into idempotency_records")) {
        return { rows: [{ workspace_id: workspaceId }] };
      }
      if (sql.includes("update artifacts")) {
        return { rows: [{ id: artifactId }] };
      }
      if (sql.includes("bytes_purge_enqueued_at")) {
        return { rows: [{ id: revisionId }] };
      }
      return { rows: [] };
    });
    const env = {
      BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() },
      DENYLIST: { put: vi.fn(async () => {}) },
    };
    const result = await runAutoDeletionDiscovery(executor, env, "2026-05-20T00:00:00.000Z");
    expect(result).toMatchObject({ discovered: 1, enqueued: 1, cap_hit: false });
    expect(send).toHaveBeenCalled();
  });

  it("replays runCommand without re-enqueueing purge work", async () => {
    const send = vi.fn(async () => ({}));
    let discovery = true;
    const executor = mockExecutor(async (sql) => {
      if (discovery && sql.includes("from artifacts")) {
        discovery = false;
        return { rows: [{ id: artifactId, workspace_id: workspaceId, revision_id: revisionId }] };
      }
      if (sql.includes("insert into idempotency_records")) {
        return { rows: [] };
      }
      if (sql.includes("select status, result_json")) {
        return {
          rows: [
            {
              status: "completed",
              result_json: { artifact_id: artifactId, expired: true },
              created_at: "2026-05-20T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });
    const env = {
      BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() },
      DENYLIST: { put: vi.fn(async () => {}) },
    };
    const result = await runAutoDeletionDiscovery(executor, env, "2026-05-20T00:00:00.000Z");
    expect(result.enqueued).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports cap_hit when more artifacts expire than the sweep cap", async () => {
    const rows = Array.from({ length: AUTO_DELETION_SWEEP_CAP + 1 }, (_, index) => ({
      id: `art_${String(index).padStart(26, "0")}`,
      workspace_id: workspaceId,
      revision_id: revisionId,
    }));
    const executor = createTransactionalSqlExecutor(async () => ({ rows }));
    const env = {
      BYTE_PURGE_QUEUE: { send: vi.fn(), sendBatch: vi.fn() },
      DENYLIST: { put: vi.fn(async () => {}) },
    };
    const result = await runAutoDeletionDiscovery(executor, env, "2026-05-20T00:00:00.000Z");
    expect(result).toMatchObject({
      discovered: AUTO_DELETION_SWEEP_CAP,
      cap_hit: true,
    });
  });

  it("skips enqueue when auto-deletion update does not expire the artifact", async () => {
    const send = vi.fn(async () => ({}));
    let discovery = true;
    const executor = mockExecutor(async (sql) => {
      if (discovery && sql.includes("from artifacts")) {
        discovery = false;
        return { rows: [{ id: artifactId, workspace_id: workspaceId, revision_id: revisionId }] };
      }
      if (sql.includes("insert into idempotency_records")) {
        return { rows: [{ workspace_id: workspaceId }] };
      }
      if (sql.includes("update artifacts")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const env = {
      BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() },
      DENYLIST: { put: vi.fn(async () => {}) },
    };
    const result = await runAutoDeletionDiscovery(executor, env, "2026-05-20T00:00:00.000Z");
    expect(result).toMatchObject({ discovered: 1, enqueued: 0, cap_hit: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("continues auto-deletion when one artifact command throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const runCommand = vi.spyOn(await import("@agent-paste/commands"), "runCommand");
    runCommand.mockRejectedValueOnce(new Error("auto_deletion_tx_failed"));
    try {
      let discovery = true;
      const executor = mockExecutor(async (sql) => {
        if (discovery && sql.includes("from artifacts")) {
          discovery = false;
          return { rows: [{ id: artifactId, workspace_id: workspaceId, revision_id: revisionId }] };
        }
        return { rows: [] };
      });
      const env = {
        BYTE_PURGE_QUEUE: { send: vi.fn(), sendBatch: vi.fn() },
        DENYLIST: { put: vi.fn(async () => {}) },
      };
      const result = await runAutoDeletionDiscovery(executor, env, "2026-05-20T00:00:00.000Z");
      expect(result).toMatchObject({ discovered: 1, enqueued: 0, cap_hit: false });
      expect(
        errorSpy.mock.calls.some((call) => String(call[0]).includes("cron.auto_deletion.artifact_failed")),
      ).toBe(true);
    } finally {
      runCommand.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("purge recovery discovery", () => {
  it("returns zero enqueued when the purge queue binding is missing", async () => {
    const executor = { query: vi.fn(), transaction: vi.fn() };
    const result = await runPurgeRecoveryDiscovery(executor, {});
    expect(result).toEqual({ discovered: 0, enqueued: 0, cap_hit: false });
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("enqueues purge work for deleted artifacts missing enqueue markers", async () => {
    const send = vi.fn(async () => ({}));
    const executor = createTransactionalSqlExecutor(async () => ({
      rows: [{ id: artifactId, workspace_id: workspaceId, revision_id: revisionId, status: "deleted" }],
    }));
    const env = {
      BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() },
      DENYLIST: { put: vi.fn(async () => {}) },
    };
    const result = await runPurgeRecoveryDiscovery(executor, env);
    expect(result).toMatchObject({ discovered: 1, enqueued: 1, cap_hit: false });
    expect(send).toHaveBeenCalled();
  });

  it("reports cap_hit when more artifacts need recovery than the sweep cap", async () => {
    const send = vi.fn(async () => ({}));
    const rows = Array.from({ length: AUTO_DELETION_SWEEP_CAP + 1 }, (_, index) => ({
      id: `art_${String(index).padStart(26, "0")}`,
      workspace_id: workspaceId,
      revision_id: revisionId,
      status: "deleted",
    }));
    const executor = createTransactionalSqlExecutor(async () => ({ rows }));
    const env = {
      BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() },
      DENYLIST: { put: vi.fn(async () => {}) },
    };
    const result = await runPurgeRecoveryDiscovery(executor, env);
    expect(result).toMatchObject({
      discovered: AUTO_DELETION_SWEEP_CAP,
      cap_hit: true,
    });
  });

  it("continues recovery when one artifact side effect throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sideEffects = vi.spyOn(await import("./lifecycle/purge-side-effects.js"), "applyArtifactPurgeSideEffects");
    sideEffects.mockRejectedValueOnce(new Error("side_effect_failed"));
    try {
      const send = vi.fn(async () => ({}));
      const executor = createTransactionalSqlExecutor(async () => ({
        rows: [{ id: artifactId, workspace_id: workspaceId, revision_id: revisionId, status: "deleted" }],
      }));
      const env = {
        BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() },
        DENYLIST: { put: vi.fn(async () => {}) },
      };
      const result = await runPurgeRecoveryDiscovery(executor, env);
      expect(result).toMatchObject({ discovered: 1, enqueued: 0, cap_hit: false });
      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("cron.purge_recovery.artifact_failed"))).toBe(
        true,
      );
    } finally {
      sideEffects.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
