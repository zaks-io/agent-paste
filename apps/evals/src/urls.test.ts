import { describe, expect, it } from "vitest";
import { classifyUrls } from "./urls";

describe("classifyUrls", () => {
  it("classifies preview artifact and claim URLs", () => {
    const urls = classifyUrls(
      "Done https://0123456789abcdef0123456789abcdef-preview.agent-paste.link/ Claim https://app.preview.agent-paste.sh/claim#token",
    );
    expect(urls.artifact).toBe("https://0123456789abcdef0123456789abcdef-preview.agent-paste.link/");
    expect(urls.claim).toBe("https://app.preview.agent-paste.sh/claim#token");
    expect(urls.production).toEqual([]);
  });

  it("classifies PR preview artifact URLs", () => {
    const artifactUrl = "https://0123456789abcdef0123456789abcdef-pr-621.agent-paste.link/";
    const urls = classifyUrls(artifactUrl);
    expect(urls.artifact).toBe(artifactUrl);
    expect(urls.production).toEqual([]);
  });

  it("classifies legacy standing-preview artifact URLs", () => {
    const artifactUrl = "https://0123456789abcdef0123456789abcdef-preview.agent-paste.sh/";
    const urls = classifyUrls(artifactUrl);
    expect(urls.artifact).toBe(artifactUrl);
    expect(urls.production).toEqual([]);
  });

  it.each(["pr-0", "pr-01", "pr-invalid"])("rejects malformed PR preview suffix %s", (suffix) => {
    const artifactUrl = `https://0123456789abcdef0123456789abcdef-${suffix}.agent-paste.link/`;
    const urls = classifyUrls(artifactUrl);
    expect(urls.artifact).toBeUndefined();
    expect(urls.production).toEqual([artifactUrl]);
  });

  it("does not classify preview apex docs as production", () => {
    const urls = classifyUrls(
      "Read https://preview.agent-paste.sh/agents.md, https://preview.agent-paste.link/agents.md, MCP https://mcp.preview.agent-paste.sh, and content https://usercontent.preview.agent-paste.link/v/token/index.html",
    );
    expect(urls.production).toEqual([]);
  });

  it("cleans escaped markdown URLs before classification", () => {
    const urls = classifyUrls('Docs: https://agent-paste.sh/agents.md\\"');
    expect(urls.production).toEqual(["https://agent-paste.sh/agents.md"]);
  });

  it("detects production artifact URLs", () => {
    const artifactUrl = "https://0123456789abcdef0123456789abcdef.agent-paste.link/";
    const signedUrl = "https://usercontent.agent-paste.link/v/token/index.html";
    const urls = classifyUrls(`${artifactUrl} ${signedUrl}`);
    expect(urls.artifact).toBe(artifactUrl);
    expect(urls.production).toEqual([artifactUrl, signedUrl]);
  });
});
