import { describe, expect, it, vi } from "vitest";
import { runAutoDeletionDiscovery } from "./discovery/auto-deletion.js";
import { runPurgeRecoveryDiscovery } from "./discovery/purge-recovery.js";
import { enqueueArtifactBytePurge } from "./lifecycle/byte-purge-enqueue.js";
import { writeArtifactDenylist } from "./lifecycle/denylist.js";
import { applyArtifactPurgeSideEffects } from "./lifecycle/purge-side-effects.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

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

  it("marks bytes_purge_enqueued_at after enqueue succeeds", async () => {
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
});

describe("auto deletion discovery", () => {
  it("returns zero enqueued when the purge queue binding is missing", async () => {
    const executor = { query: vi.fn(), transaction: vi.fn() };
    const result = await runAutoDeletionDiscovery(executor, {}, "2026-05-20T00:00:00.000Z");
    expect(result).toEqual({ discovered: 0, enqueued: 0, cap_hit: false });
    expect(executor.query).not.toHaveBeenCalled();
  });
});

describe("purge recovery discovery", () => {
  it("enqueues purge work for deleted artifacts missing enqueue markers", async () => {
    const send = vi.fn(async () => ({}));
    const executor = {
      query: vi.fn(async () => ({
        rows: [{ id: artifactId, workspace_id: workspaceId, revision_id: revisionId, status: "deleted" }],
      })),
      transaction: vi.fn(),
    };
    const env = {
      BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() },
      DENYLIST: { put: vi.fn(async () => {}) },
    };
    const result = await runPurgeRecoveryDiscovery(executor, env);
    expect(result).toMatchObject({ discovered: 1, enqueued: 1, cap_hit: false });
    expect(send).toHaveBeenCalled();
  });
});
