import { describe, expect, it, vi } from "vitest";
import { enqueuePostPublishJobs } from "./post-publish.js";

const input = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  revisionId: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
  requestedAt: "2026-05-20T00:00:00.000Z",
};

describe("enqueuePostPublishJobs", () => {
  it("no-ops when bundle generation is disabled", async () => {
    const send = vi.fn();
    await enqueuePostPublishJobs({ BUNDLE_GENERATE_QUEUE: { send } }, { ...input, bundleStatus: "disabled" });
    expect(send).not.toHaveBeenCalled();
  });

  it("no-ops when the bundle queue binding is missing", async () => {
    await enqueuePostPublishJobs({}, { ...input, bundleStatus: "pending" });
  });

  it("enqueues bundle.generate.v1 when publish leaves bundle pending", async () => {
    const send = vi.fn(async () => ({}));
    await enqueuePostPublishJobs({ BUNDLE_GENERATE_QUEUE: { send } }, { ...input, bundleStatus: "pending" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "bundle.generate.v1",
        workspace_id: input.workspaceId,
        artifact_id: input.artifactId,
        revision_id: input.revisionId,
        reason: "publish",
      }),
    );
  });
});
