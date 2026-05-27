import { describe, expect, it, vi } from "vitest";
import {
  applyArtifactPurgeSideEffects,
  enqueueArtifactBytePurge,
  writeArtifactDenylist,
} from "./artifact-invalidation.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

describe("artifact invalidation", () => {
  it("skips byte purge enqueue when denylist writes fail", async () => {
    const send = vi.fn();
    const result = await applyArtifactPurgeSideEffects(
      {
        DENYLIST: {
          put: vi.fn(async () => {
            throw new Error("kv down");
          }),
        },
        BYTE_PURGE_QUEUE: { send },
      },
      { query: vi.fn(), transaction: vi.fn() },
      { workspaceId, artifactId, revisionId, reason: "deletion" },
    );
    expect(result).toEqual({ denylistWritten: false, enqueued: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("retries denylist writes before giving up", async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue(undefined);
    await expect(writeArtifactDenylist({ DENYLIST: { put } }, artifactId)).resolves.toBe(true);
    expect(put).toHaveBeenCalledTimes(3);
  });

  it("marks bytes_purge_enqueued_at after enqueue succeeds", async () => {
    const send = vi.fn(async () => ({}));
    const query = vi.fn(async () => ({ rows: [{ id: revisionId }] }));
    const executor = { query, transaction: vi.fn(async (run) => run({ query, transaction: vi.fn() })) };
    await expect(
      enqueueArtifactBytePurge({ BYTE_PURGE_QUEUE: { send } }, executor, {
        workspaceId,
        artifactId,
        revisionId,
        reason: "deletion",
      }),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("bytes_purge_enqueued_at"), [
      workspaceId,
      revisionId,
      artifactId,
    ]);
  });

  it("runs denylist before enqueue in applyArtifactPurgeSideEffects", async () => {
    const order: string[] = [];
    const send = vi.fn(async () => {
      order.push("enqueue");
      return {};
    });
    const put = vi.fn(async () => {
      order.push("denylist");
    });
    const query = vi.fn(async () => ({ rows: [{ id: revisionId }] }));
    const executor = { query, transaction: vi.fn(async (run) => run({ query, transaction: vi.fn() })) };
    await applyArtifactPurgeSideEffects({ DENYLIST: { put }, BYTE_PURGE_QUEUE: { send } }, executor, {
      workspaceId,
      artifactId,
      revisionId,
      reason: "deletion",
    });
    expect(order).toEqual(["denylist", "enqueue"]);
  });
});
