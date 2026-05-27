import { describe, expect, it } from "vitest";
import { BundleGenerateMessage, BytePurgeMessage, parseJobsQueueMessage, SafetyScanMessage } from "./jobs.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

describe("jobs queue messages", () => {
  it("parses byte purge payloads", () => {
    const body = {
      type: "byte.purge.v1",
      workspace_id: workspaceId,
      artifact_id: artifactId,
      revision_id: revisionId,
      upload_session_id: null,
      prefixes: ["env/live/workspaces/example/"],
      reason: "deletion",
    };
    expect(parseJobsQueueMessage(body)).toEqual(BytePurgeMessage.parse(body));
  });

  it("parses safety scan payloads", () => {
    const body = {
      type: "safety.scan.v1",
      workspace_id: workspaceId,
      artifact_id: artifactId,
      revision_id: revisionId,
      scanner_id: "stub_v1",
      scanner_version: "1",
      requested_at: "2026-05-20T00:00:00.000Z",
    };
    expect(parseJobsQueueMessage(body)).toEqual(SafetyScanMessage.parse(body));
  });

  it("parses bundle generate payloads", () => {
    const body = {
      type: "bundle.generate.v1",
      workspace_id: workspaceId,
      artifact_id: artifactId,
      revision_id: revisionId,
      requested_at: "2026-05-20T00:00:00.000Z",
      reason: "publish",
    };
    expect(parseJobsQueueMessage(body)).toEqual(BundleGenerateMessage.parse(body));
  });
});
