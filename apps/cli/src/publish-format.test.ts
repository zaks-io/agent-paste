import { describe, expect, it } from "vitest";
import { artifactUpdateReference } from "./publish-format.js";

describe("artifactUpdateReference", () => {
  it.each([
    "01234-56789-abcde-fghjd",
    "01234-56789-abcde-fghjd-preview",
    "01234-56789-abcde-fghjd-pr-651",
    "0123456789abcdef0123456789abcdef",
  ])("uses the short artifact ID %s in update commands", (artifactId) => {
    const url = `https://${artifactId}.agent-paste.link/`;
    expect(artifactUpdateReference({ artifact_id: "art_1", url })).toBe(artifactId);
  });

  it("falls back to the canonical ID for a local HTTP content URL", () => {
    expect(artifactUpdateReference({ artifact_id: "art_1", url: "http://127.0.0.1:8788/v/token/index.html" })).toBe(
      "art_1",
    );
  });
});
