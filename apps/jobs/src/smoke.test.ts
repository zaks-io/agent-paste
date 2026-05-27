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

describe("jobs smoke harness", () => {
  it("detects non-production environments", () => {
    expect(isNonProductionEnv({ AGENT_PASTE_ENV: "dev" })).toBe(true);
    expect(isNonProductionEnv({ AGENT_PASTE_ENV: "preview" })).toBe(true);
    expect(isNonProductionEnv({ AGENT_PASTE_ENV: "production" })).toBe(false);
    expect(isNonProductionEnv({ AGENT_PASTE_ENV: "live" })).toBe(false);
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
    ).resolves.toEqual({ deleted_r2_objects: 0 });
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
