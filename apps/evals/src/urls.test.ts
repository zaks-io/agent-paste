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

  it("does not classify preview apex docs as production", () => {
    const urls = classifyUrls(
      "Read https://preview.agent-paste.sh/agents.md and MCP https://mcp.preview.agent-paste.sh",
    );
    expect(urls.production).toEqual([]);
  });

  it("cleans escaped markdown URLs before classification", () => {
    const urls = classifyUrls('Docs: https://agent-paste.sh/agents.md\\"');
    expect(urls.production).toEqual(["https://agent-paste.sh/agents.md"]);
  });

  it("detects production Agent Paste URLs", () => {
    const urls = classifyUrls("https://app.agent-paste.sh/al/abc#secret");
    expect(urls.production).toEqual(["https://app.agent-paste.sh/al/abc#secret"]);
  });
});
