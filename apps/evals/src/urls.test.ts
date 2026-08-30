import { describe, expect, it } from "vitest";
import { classifyUrls } from "./urls";

describe("classifyUrls", () => {
  it("classifies preview artifact and claim URLs", () => {
    const urls = classifyUrls(
      "Done https://0123456789abcdef0123456789abcdef-preview.agent-paste.sh/ Claim https://app.preview.agent-paste.sh/claim#token",
    );
    expect(urls.artifact).toBe("https://0123456789abcdef0123456789abcdef-preview.agent-paste.sh/");
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

  it("detects production artifact URLs", () => {
    const url = "https://0123456789abcdef0123456789abcdef.agent-paste.sh/";
    const urls = classifyUrls(url);
    expect(urls.artifact).toBe(url);
    expect(urls.production).toEqual([url]);
  });
});
