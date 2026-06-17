import { describe, expect, it, vi } from "vitest";
import {
  type AnalyticsEngineDataPoint,
  artifactEventDataPoint,
  funnelEventDataPoint,
  writeArtifactEvent,
  writeFunnelEvent,
} from "./analytics.js";

const baseEvent = {
  workspaceId: "ws_1",
  artifactId: "art_1",
  revisionId: "rev_1",
} as const;

describe("artifactEventDataPoint", () => {
  it("indexes on workspace and carries the kind in blob1", () => {
    const point = artifactEventDataPoint({ ...baseEvent, kind: "publish", bytes: 2048, detail: "ephemeral" });
    expect(point).toEqual<AnalyticsEngineDataPoint>({
      indexes: ["ws_1"],
      blobs: ["publish", "art_1", "rev_1", "ephemeral"],
      doubles: [2048],
    });
  });

  it("defaults bytes to 0 and detail to empty string", () => {
    const point = artifactEventDataPoint({ ...baseEvent, kind: "read" });
    expect(point.doubles).toEqual([0]);
    expect(point.blobs?.[3]).toBe("");
  });

  it("coerces non-finite bytes to 0", () => {
    expect(artifactEventDataPoint({ ...baseEvent, kind: "read", bytes: Number.NaN }).doubles).toEqual([0]);
  });
});

describe("writeArtifactEvent", () => {
  it("no-ops when the binding is absent", () => {
    expect(() => writeArtifactEvent(undefined, { ...baseEvent, kind: "read" })).not.toThrow();
  });

  it("writes a data point through the binding", () => {
    const writeDataPoint = vi.fn();
    writeArtifactEvent({ writeDataPoint }, { ...baseEvent, kind: "publish", bytes: 10 });
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ["ws_1"],
      blobs: ["publish", "art_1", "rev_1", ""],
      doubles: [10],
    });
  });

  it("swallows errors thrown by the binding", () => {
    const writeDataPoint = vi.fn(() => {
      throw new Error("AE down");
    });
    expect(() => writeArtifactEvent({ writeDataPoint }, { ...baseEvent, kind: "read" })).not.toThrow();
  });
});

describe("funnelEventDataPoint", () => {
  it("indexes on claim code when present and carries stable dimensions", () => {
    const point = funnelEventDataPoint({
      kind: "ephemeral_publish_created",
      surface: "api",
      claimCode: "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD",
      workspaceId: "ws_1",
      artifactId: "art_1",
      claimTokenId: "ct_1",
      promptVariant: "hero_agent_session_v1",
      status: "success",
      artifactCount: 2,
    });
    expect(point).toEqual<AnalyticsEngineDataPoint>({
      indexes: ["clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD"],
      blobs: [
        "ephemeral_publish_created",
        "api",
        "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD",
        "ws_1",
        "art_1",
        "ct_1",
        "hero_agent_session_v1",
        "success",
      ],
      doubles: [1, 2],
    });
  });

  it("falls back to workspace id, then event kind, for unattributed events", () => {
    expect(funnelEventDataPoint({ kind: "link_claimed", surface: "api", workspaceId: "ws_1" }).indexes).toEqual([
      "ws_1",
    ]);
    expect(funnelEventDataPoint({ kind: "prompt_copied", surface: "apex" }).indexes).toEqual(["prompt_copied"]);
  });
});

describe("writeFunnelEvent", () => {
  it("writes a data point through the binding", () => {
    const writeDataPoint = vi.fn();
    writeFunnelEvent(
      { writeDataPoint },
      { kind: "prompt_copied", surface: "apex", claimCode: "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD" },
    );
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ["clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD"],
      blobs: ["prompt_copied", "apex", "clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD", "", "", "", "", ""],
      doubles: [1, 0],
    });
  });

  it("swallows errors thrown by the binding", () => {
    const writeDataPoint = vi.fn(() => {
      throw new Error("AE down");
    });
    expect(() => writeFunnelEvent({ writeDataPoint }, { kind: "prompt_copied", surface: "apex" })).not.toThrow();
  });
});
