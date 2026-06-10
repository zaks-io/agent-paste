import { envScopedRevisionPrefix, revisionPurgePrefix } from "@agent-paste/db";
import { describe, expect, it, vi } from "vitest";
import { enqueueRevisionBytePurge } from "./revision-byte-purge-enqueue.js";
import { writeRevisionDenylist } from "./revision-denylist.js";
import { applyRevisionPurgeSideEffects } from "./revision-purge-side-effects.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0";

describe("revision denylist", () => {
  it("returns false when revision id or denylist binding is missing", async () => {
    await expect(writeRevisionDenylist({ DENYLIST: { put: vi.fn() } }, "")).resolves.toBe(false);
    await expect(writeRevisionDenylist({}, revisionId)).resolves.toBe(false);
  });

  it("retries flaky puts and succeeds", async () => {
    let attempts = 0;
    const put = vi.fn(async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("kv_flaky");
      }
    });
    await expect(writeRevisionDenylist({ DENYLIST: { put } }, revisionId)).resolves.toBe(true);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledWith(`rd:${revisionId}`, expect.any(String), expect.any(Object));
  });

  it("returns false after repeated denylist failures", async () => {
    const put = vi.fn(async () => {
      throw new Error("kv_down");
    });
    await expect(writeRevisionDenylist({ DENYLIST: { put } }, revisionId)).resolves.toBe(false);
    expect(put).toHaveBeenCalledTimes(3);
  });
});

describe("revision byte purge enqueue", () => {
  it("returns false when the purge queue binding is missing", async () => {
    const executor = { query: vi.fn(), transaction: vi.fn() };
    await expect(
      enqueueRevisionBytePurge({}, executor, { workspaceId, artifactId, revisionId, reason: "retention" }),
    ).resolves.toBe(false);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("returns false when queue send fails", async () => {
    const send = vi.fn(async () => {
      throw new Error("queue_full");
    });
    const executor = { query: vi.fn(), transaction: vi.fn() };
    await expect(
      enqueueRevisionBytePurge({ BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() } }, executor, {
        workspaceId,
        artifactId,
        revisionId,
        reason: "retention",
      }),
    ).resolves.toBe(false);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("returns false when revision bookkeeping updates zero rows", async () => {
    const send = vi.fn(async () => ({}));
    const executor = {
      query: vi.fn(async () => ({ rows: [] })),
      transaction: vi.fn(),
    };
    await expect(
      enqueueRevisionBytePurge({ BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() } }, executor, {
        workspaceId,
        artifactId,
        revisionId,
        reason: "retention",
      }),
    ).resolves.toBe(false);
    expect(send).toHaveBeenCalled();
  });

  it("returns false when revision bookkeeping throws", async () => {
    const send = vi.fn(async () => ({}));
    const executor = {
      query: vi.fn(async () => {
        throw new Error("db_unavailable");
      }),
      transaction: vi.fn(),
    };
    await expect(
      enqueueRevisionBytePurge({ BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() } }, executor, {
        workspaceId,
        artifactId,
        revisionId,
        reason: "retention",
      }),
    ).resolves.toBe(false);
    expect(send).toHaveBeenCalled();
  });

  it("marks bytes_purge_enqueued_at after enqueue succeeds", async () => {
    const send = vi.fn(async () => ({}));
    const executor = {
      query: vi.fn(async () => ({ rows: [{ id: revisionId }] })),
      transaction: vi.fn(),
    };
    await expect(
      enqueueRevisionBytePurge({ BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() } }, executor, {
        workspaceId,
        artifactId,
        revisionId,
        reason: "retention",
      }),
    ).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        prefixes: [
          revisionPurgePrefix(artifactId, revisionId),
          envScopedRevisionPrefix({ workspaceId, artifactId, revisionId }),
        ],
        reason: "retention",
      }),
    );
  });
});

describe("revision purge side effects", () => {
  it("skips byte purge when revision denylist writes fail", async () => {
    const send = vi.fn();
    const executor = { query: vi.fn(), transaction: vi.fn() };
    const result = await applyRevisionPurgeSideEffects(
      {
        DENYLIST: {
          put: vi.fn(async () => {
            throw new Error("kv_unavailable");
          }),
        },
        BYTE_PURGE_QUEUE: { send, sendBatch: vi.fn() },
      },
      executor,
      { workspaceId, artifactId, revisionId, reason: "retention" },
    );
    expect(result).toEqual({ denylistWritten: false, enqueued: false });
    expect(send).not.toHaveBeenCalled();
  });
});
