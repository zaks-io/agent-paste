import { describe, expect, it } from "vitest";
import { classifyUrls } from "./urls";

describe("classifyUrls", () => {
  it("classifies preview unlisted and claim URLs", () => {
    const urls = classifyUrls(
      "Done https://app.preview.agent-paste.sh/al/abc#secret Claim https://app.preview.agent-paste.sh/claim#token",
    );
    expect(urls.unlisted).toBe("https://app.preview.agent-paste.sh/al/abc#secret");
    expect(urls.claim).toBe("https://app.preview.agent-paste.sh/claim#token");
    expect(urls.production).toEqual([]);
  });

  it("detects production Agent Paste URLs", () => {
    const urls = classifyUrls("https://app.agent-paste.sh/al/abc#secret");
    expect(urls.production).toEqual(["https://app.agent-paste.sh/al/abc#secret"]);
  });
});
