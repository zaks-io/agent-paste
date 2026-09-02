import type { ApiClient } from "@agent-paste/api-client";
import { describe, expect, it, vi } from "vitest";
import { apiClientTransport } from "./publish-transport.js";

const ARTIFACT_ID = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as never;
const REVISION_ID = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as never;
const URL = "https://0123456789abcdef0123456789abcdef.agent-paste.link/";

function clientWith(overrides: {
  publish: () => Promise<never>;
  getRevisionAgentView: () => Promise<Record<string, unknown>>;
  getAgentView?: () => Promise<Record<string, unknown>>;
}): ApiClient {
  return {
    revisions: { publish: overrides.publish },
    artifacts: {
      getRevisionAgentView: overrides.getRevisionAgentView,
      getAgentView: overrides.getAgentView,
    },
  } as unknown as ApiClient;
}

function recoveredView(revisionId = REVISION_ID) {
  return {
    artifact_id: ARTIFACT_ID,
    revision_id: revisionId,
    title: "Recovered",
    url: URL,
    expires_at: "2026-12-31T00:00:00.000Z",
  };
}

describe("apiClientTransport publish recovery", () => {
  it("recovers the exact committed Revision when success-response parsing fails", async () => {
    const parseFailure = new Error("publish response contract drifted");
    const getRevisionAgentView = vi.fn(async () => recoveredView());
    const getAgentView = vi.fn(async () => recoveredView("rev_01HZY7Q8X9Y2S3T4V5W6X7Y8ZA" as never));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const transport = apiClientTransport(
      clientWith({
        publish: vi.fn(async () => Promise.reject(parseFailure)),
        getRevisionAgentView,
        getAgentView,
      }),
    );

    await expect(transport.publishRevision(ARTIFACT_ID, REVISION_ID, "key" as never)).resolves.toEqual({
      artifact_id: ARTIFACT_ID,
      revision_id: REVISION_ID,
      title: "Recovered",
      url: URL,
      expires_at: "2026-12-31T00:00:00.000Z",
    });
    expect(getRevisionAgentView).toHaveBeenCalledWith(ARTIFACT_ID, REVISION_ID);
    expect(getAgentView).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("recovered the exact Artifact URL"));
  });

  it("rethrows the publish failure when the pinned Revision does not match", async () => {
    const publishFailure = new Error("network failed before commit");
    const transport = apiClientTransport(
      clientWith({
        publish: vi.fn(async () => Promise.reject(publishFailure)),
        getRevisionAgentView: vi.fn(async () => recoveredView("rev_01HZY7Q8X9Y2S3T4V5W6X7Y8ZA" as never)),
      }),
    );

    await expect(transport.publishRevision(ARTIFACT_ID, REVISION_ID, "key" as never)).rejects.toBe(publishFailure);
  });

  it("rethrows the publish failure when the recovery lookup also fails", async () => {
    const publishFailure = new Error("publish failed");
    const transport = apiClientTransport(
      clientWith({
        publish: vi.fn(async () => Promise.reject(publishFailure)),
        getRevisionAgentView: vi.fn(async () => Promise.reject(new Error("lookup failed"))),
      }),
    );

    await expect(transport.publishRevision(ARTIFACT_ID, REVISION_ID, "key" as never)).rejects.toBe(publishFailure);
  });
});
