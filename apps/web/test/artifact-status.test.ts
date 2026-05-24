import { describe, expect, it } from "vitest";
import { artifactStatusTone } from "../src/lib/artifact-status";

describe("artifactStatusTone", () => {
  it("maps each artifact status to a distinct semantic badge tone", () => {
    expect(artifactStatusTone("Published")).toBe("success");
    expect(artifactStatusTone("Expired")).toBe("warning");
    expect(artifactStatusTone("Deleted")).toBe("destructive");
  });
});
