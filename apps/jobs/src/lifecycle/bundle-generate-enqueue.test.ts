import { describe, expect, it, vi } from "vitest";
import { enqueueBundleGenerate } from "./bundle-generate-enqueue.js";

describe("enqueueBundleGenerate", () => {
  it("returns false when the queue binding is missing", async () => {
    await expect(
      enqueueBundleGenerate(
        {},
        {
          workspaceId: "00000000-0000-0000-0000-000000000000",
          artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          requestedAt: "2026-05-20T00:00:00.000Z",
        },
      ),
    ).resolves.toBe(false);
  });

  it("sends a bundle.generate.v1 message", async () => {
    const send = vi.fn(async () => ({}));
    await expect(
      enqueueBundleGenerate(
        { BUNDLE_GENERATE_QUEUE: { send, sendBatch: vi.fn() } },
        {
          workspaceId: "00000000-0000-0000-0000-000000000000",
          artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          requestedAt: "2026-05-20T00:00:00.000Z",
        },
      ),
    ).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "bundle.generate.v1",
        revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
        reason: "publish",
      }),
    );
  });

  it("returns false when queue send fails", async () => {
    const send = vi.fn(async () => {
      throw new Error("queue unavailable");
    });
    await expect(
      enqueueBundleGenerate(
        { BUNDLE_GENERATE_QUEUE: { send, sendBatch: vi.fn() } },
        {
          workspaceId: "00000000-0000-0000-0000-000000000000",
          artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          requestedAt: "2026-05-20T00:00:00.000Z",
        },
      ),
    ).resolves.toBe(false);
  });
});
