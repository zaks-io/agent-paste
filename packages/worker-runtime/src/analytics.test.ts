import { describe, expect, it, vi } from "vitest";
import { type AnalyticsEngineDataPoint, artifactEventDataPoint, writeArtifactEvent } from "./analytics.js";

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
