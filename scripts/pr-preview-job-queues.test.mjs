import { describe, expect, it } from "vitest";
import { prPreviewJobQueues } from "./pr-preview-job-queues.mjs";

describe("prPreviewJobQueues", () => {
  it("returns PR-scoped queues with consumer detach order", () => {
    const queues = prPreviewJobQueues("114");

    expect(queues.creationOrder).toEqual([
      "byte-purge-dlq-preview-pr-114",
      "safety-scan-dlq-preview-pr-114",
      "bundle-generate-dlq-preview-pr-114",
      "byte-purge-preview-pr-114",
      "safety-scan-preview-pr-114",
      "bundle-generate-preview-pr-114",
    ]);
    expect(queues.consumerDetachOrder).toEqual([
      "byte-purge-preview-pr-114",
      "safety-scan-preview-pr-114",
      "bundle-generate-preview-pr-114",
      "bundle-generate-dlq-preview-pr-114",
    ]);
    expect(queues.deletionOrder.at(0)).toBe("byte-purge-preview-pr-114");
  });
});
