import { describe, expect, it } from "vitest";
import { artifactUpdateReference } from "./publish-format.js";

describe("artifactUpdateReference", () => {
  it("uses the published HTTPS URL when the CLI accepts it as an Artifact reference", () => {
    const url = "https://0123456789abcdef0123456789abcdef.agent-paste.link/";
    expect(artifactUpdateReference({ artifact_id: "art_1", url })).toBe(url);
  });

  it("falls back to the canonical ID for a local HTTP content URL", () => {
    expect(artifactUpdateReference({ artifact_id: "art_1", url: "http://127.0.0.1:8788/v/token/index.html" })).toBe(
      "art_1",
    );
  });
});
