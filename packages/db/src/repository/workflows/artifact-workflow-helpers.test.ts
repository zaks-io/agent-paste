import { describe, expect, it } from "vitest";
import { nextArtifactUpdatedAt } from "./artifact-workflow-helpers.js";

describe("nextArtifactUpdatedAt", () => {
  it("keeps capability manifest state strictly monotonic when mutations share a millisecond", () => {
    expect(nextArtifactUpdatedAt("2026-08-24T00:00:00.000Z", "2026-08-24T00:00:00.000Z")).toBe(
      "2026-08-24T00:00:00.001Z",
    );
    expect(nextArtifactUpdatedAt("2026-08-24T00:00:00.000Z", "2026-08-24T00:00:01.000Z")).toBe(
      "2026-08-24T00:00:01.000Z",
    );
  });
});
