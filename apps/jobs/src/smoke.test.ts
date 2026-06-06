import { describe, expect, it, vi } from "vitest";
import worker, {
  authenticateSmokeHarness,
  isNonProductionEnv,
  runSmokeArtifactPurgeRecovery,
  runSmokeLifecycleCleanup,
} from "./index.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

function createSqlExecutorMock(handler: (sql: string) => Promise<{ rows: unknown[] }>) {
  const query = vi.fn(handler);
  return {
    query,
    transaction: vi.fn(async (run: (tx: { query: typeof query }) => Promise<unknown>) => run({ query })),
  };
}

describe("jobs smoke harness", () => {
  it("detects non-production environments", () => {
    expect(isNonProductionEnv({ AGENT_PASTE_ENV: "dev" })).toBe(true);
    expect(isNonProductionEnv({ AGENT_PASTE_ENV: "preview" })).toBe(true);
    expect(isNonProductionEnv({ AGENT_PASTE_ENV: "production" })).toBe(false);
    expect(isNonProductionEnv({ AGENT_PASTE_ENV: "live" })).toBe(false);
    for (const value of [undefined, "", "prod", "live-eu", "staging"]) {
      expect(isNonProductionEnv({ AGENT_PASTE_ENV: value })).toBe(false);
    }
  });

  it("authenticates the smoke harness secret", () => {
    const request = new Request("https://jobs.test/__test__/run-cleanup", {
      headers: { authorization: "Bearer harness-secret" },
    });
    expect(authenticateSmokeHarness(request, { SMOKE_HARNESS_SECRET: "harness-secret" })).toBe(true);
    expect(authenticateSmokeHarness(request, { SMOKE_HARNESS_SECRET: "other-secret" })).toBe(false);
  });

  it("throws when database bindings are missing for SQL cleanup", async () => {
    await expect(runSmokeLifecycleCleanup({})).rejects.toThrow("database_unavailable");
  });

  it("skips expired artifacts without revision ids during local MVP cleanup", async () => {
    const env = {
      LOCAL_MVP_REPOSITORY: {
        async runCleanup() {
          return { expired_artifacts: 2, expired_artifact_ids: [artifactId, "art_missing_revision"] };
        },
        artifacts: new Map([
          [artifactId, { workspace_id: workspaceId, revision_id: revisionId }],
          ["art_missing_revision", { workspace_id: workspaceId, revision_id: null }],
        ]),
        revisions: new Map([[revisionId, {}]]),
      },
      BYTE_PURGE_QUEUE: { send: vi.fn(async () => ({})), sendBatch: vi.fn() },
      DENYLIST: { put: vi.fn(async () => {}) },
    };
    await expect(runSmokeLifecycleCleanup(env)).resolves.toMatchObject({
      expired_artifacts: 2,
      enqueued: 1,
    });
  });

  it("returns zero deleted objects when local MVP artifact is missing", async () => {
    await expect(
      runSmokeArtifactPurgeRecovery(
        {
          LOCAL_MVP_REPOSITORY: {
            artifacts: new Map(),
            revisions: new Map(),
            runCleanup: vi.fn(),
          },
        },
        artifactId,
      ),
    ).resolves.toMatchObject({
      deleted_r2_objects: 0,
      enqueued: false,
      artifact_found: false,
      eligibility: "row_missing",
    });
  });

  it("runs local MVP lifecycle cleanup through the repository adapter", async () => {
    const artifacts = new Map([[artifactId, { workspace_id: workspaceId, revision_id: revisionId }]]);
    const revisions = new Map<string, { bytes_purge_enqueued_at?: string | null }>([[revisionId, {}]]);
    const env = {
      LOCAL_MVP_REPOSITORY: {
        async runCleanup() {
          return { expired_artifacts: 1, expired_artifact_ids: [artifactId] };
        },
        artifacts,
        revisions,
      },
      BYTE_PURGE_QUEUE: { send: vi.fn(async () => ({})), sendBatch: vi.fn() },
      DENYLIST: { put: vi.fn(async () => {}) },
      SYNC_BYTE_PURGE_DELETED_OBJECTS: 0,
      ARTIFACTS: {
        list: vi.fn(async () => ({ objects: [], truncated: false })),
        delete: vi.fn(async (keys: string[]) => {
          env.SYNC_BYTE_PURGE_DELETED_OBJECTS = (env.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0) + keys.length;
        }),
      },
    };

    await expect(runSmokeLifecycleCleanup(env)).resolves.toMatchObject({
      expired_artifacts: 1,
      enqueued: 1,
    });
    expect(env.BYTE_PURGE_QUEUE.send).toHaveBeenCalled();
  });

  it("runs local MVP purge recovery for deleted artifacts", async () => {
    const env = {
      LOCAL_MVP_REPOSITORY: {
        artifacts: new Map([[artifactId, { workspace_id: workspaceId, revision_id: revisionId }]]),
        revisions: new Map([[revisionId, {}]]),
        runCleanup: vi.fn(),
      },
      DENYLIST: { put: vi.fn(async () => {}) },
      SYNC_BYTE_PURGE_DELETED_OBJECTS: 0,
      ARTIFACTS: {
        list: vi.fn(async () => ({ objects: [{ key: `artifacts/${artifactId}/a.txt` }], truncated: false })),
        delete: vi.fn(async (keys: string[]) => {
          env.SYNC_BYTE_PURGE_DELETED_OBJECTS = (env.SYNC_BYTE_PURGE_DELETED_OBJECTS ?? 0) + keys.length;
        }),
      },
    };
    env.BYTE_PURGE_QUEUE = {
      send: vi.fn(async (message) => {
        const { handleQueueBatch } = await import("./queue.js");
        await handleQueueBatch(
          {
            queue: "byte-purge",
            messages: [{ body: message, ack: vi.fn(), retry: vi.fn() }],
          },
          env,
        );
      }),
      sendBatch: vi.fn(),
    };

    await expect(runSmokeArtifactPurgeRecovery(env, artifactId)).resolves.toMatchObject({
      deleted_r2_objects: 1,
      enqueued: true,
      artifact_found: true,
      eligibility: "eligible",
    });
  });

  it("purges hosted preview artifact prefix through purge-recovery route", async () => {
    const r2Key = `artifacts/${artifactId}/revisions/${revisionId}/files/index.html`;
    const deleted: string[][] = [];
    const env = {
      AGENT_PASTE_ENV: "preview",
      SMOKE_HARNESS_SECRET: "harness",
      DENYLIST: { put: vi.fn(async () => {}) },
      BYTE_PURGE_QUEUE: { send: vi.fn(async () => ({})), sendBatch: vi.fn() },
      DB: createSqlExecutorMock(async (sql: string) => {
        if (sql.includes("from artifacts")) {
          return {
            rows: [
              {
                id: artifactId,
                workspace_id: workspaceId,
                revision_id: revisionId,
                status: "deleted",
                deleted_at: "2026-05-27T00:00:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("bytes_purge_enqueued_at")) {
          return { rows: [{ id: revisionId }] };
        }
        return { rows: [] };
      }),
      ARTIFACTS: {
        list: vi.fn(async ({ prefix }: { prefix: string }) => {
          if (prefix === `artifacts/${artifactId}/`) {
            return { objects: [{ key: r2Key }], truncated: false };
          }
          return { objects: [], truncated: false };
        }),
        delete: vi.fn(async (keys: string[]) => {
          deleted.push(keys);
        }),
      },
    };

    const response = await worker.fetch(
      new Request("https://jobs.test/__test__/purge-recovery", {
        method: "POST",
        headers: {
          authorization: "Bearer harness",
          "content-type": "application/json",
        },
        body: JSON.stringify({ artifact_id: artifactId }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      artifact_found: true,
      eligibility: "eligible",
      enqueued: true,
      deleted_r2_objects: 1,
      status: "deleted",
    });
    expect(deleted).toEqual([[r2Key]]);
    expect(env.BYTE_PURGE_QUEUE.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "byte.purge.v1",
        artifact_id: artifactId,
        prefixes: [`artifacts/${artifactId}/`],
      }),
      undefined,
    );
  });

  it("reports not_deleted_or_expired from purge-recovery route", async () => {
    const env = {
      AGENT_PASTE_ENV: "preview",
      SMOKE_HARNESS_SECRET: "harness",
      DB: createSqlExecutorMock(async (sql: string) => {
        if (sql.includes("from artifacts")) {
          return {
            rows: [
              {
                id: artifactId,
                workspace_id: workspaceId,
                revision_id: revisionId,
                status: "active",
                deleted_at: null,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const response = await worker.fetch(
      new Request("https://jobs.test/__test__/purge-recovery", {
        method: "POST",
        headers: {
          authorization: "Bearer harness",
          "content-type": "application/json",
        },
        body: JSON.stringify({ artifact_id: artifactId }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      artifact_found: false,
      eligibility: "not_deleted_or_expired",
      status: "active",
      enqueued: false,
      deleted_r2_objects: 0,
    });
  });

  it("serves smoke cleanup and purge recovery routes in non-production", async () => {
    const env = {
      AGENT_PASTE_ENV: "preview",
      SMOKE_HARNESS_SECRET: "harness",
      LOCAL_MVP_REPOSITORY: {
        async runCleanup() {
          return { expired_artifacts: 0, expired_artifact_ids: [] };
        },
        artifacts: new Map(),
        revisions: new Map(),
      },
      BYTE_PURGE_QUEUE: { send: vi.fn(), sendBatch: vi.fn() },
    };

    const cleanup = await worker.fetch(
      new Request("https://jobs.test/__test__/run-cleanup", {
        method: "POST",
        headers: { authorization: "Bearer harness" },
      }),
      env,
    );
    expect(cleanup.status).toBe(200);

    const missing = await worker.fetch(new Request("https://jobs.test/__test__/run-cleanup", { method: "POST" }), env);
    expect(missing.status).toBe(404);

    for (const value of [undefined, "", "prod", "live-eu"]) {
      const failClosed = await worker.fetch(
        new Request("https://jobs.test/__test__/run-cleanup", {
          method: "POST",
          headers: { authorization: "Bearer harness" },
        }),
        { ...env, AGENT_PASTE_ENV: value },
      );
      expect(failClosed.status).toBe(404);
    }

    const recovery = await worker.fetch(
      new Request("https://jobs.test/__test__/purge-recovery", {
        method: "POST",
        headers: {
          authorization: "Bearer harness",
          "content-type": "application/json",
        },
        body: JSON.stringify({ artifact_id: "art_missing" }),
      }),
      env,
    );
    expect(recovery.status).toBe(200);

    const invalid = await worker.fetch(
      new Request("https://jobs.test/__test__/purge-recovery", {
        method: "POST",
        headers: {
          authorization: "Bearer harness",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(invalid.status).toBe(400);

    const malformed = await worker.fetch(
      new Request("https://jobs.test/__test__/purge-recovery", {
        method: "POST",
        headers: {
          authorization: "Bearer harness",
          "content-type": "application/json",
        },
        body: "{not-json",
      }),
      env,
    );
    expect(malformed.status).toBe(400);
  });
});
