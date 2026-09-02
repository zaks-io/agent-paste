import { describe, expect, it } from "vitest";
import { prefersMarkdown } from "./accept";

const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

describe("prefersMarkdown", () => {
  it.each([
    ["text/markdown", true],
    ["text/markdown; charset=utf-8", true],
    ["text/x-markdown", true],
    ["text/markdown, text/html;q=0.5", true],
    ["text/html;q=0.5, text/markdown;q=0.9", true],
    ["text/markdown, */*;q=0.1", true],
    ["TEXT/MARKDOWN", true],
    ["text/markdown;q=bogus", true],
    ["text/markdown;q=1.0, text/html", true],
    // A partially numeric weight is a typo, not a ranking: `parseFloat` alone
    // would read this as 0.9 and hand the page to HTML.
    ["text/markdown;q=0.9junk, text/html", true],
    ["text/markdown;q=0", false],
    ["text/markdown;q=0.0", false],
    ["text/markdown;q=0.4, text/html;q=0.8", false],
    ["text/html, text/markdown;q=0.9", false],
    [BROWSER_ACCEPT, false],
    ["*/*", false],
    ["text/*", false],
    ["text/plain", false],
    ["", false],
  ])("reads %j as %s", (accept, expected) => {
    expect(prefersMarkdown(accept)).toBe(expected);
  });

  it("defaults to HTML when the header is absent", () => {
    expect(prefersMarkdown(null)).toBe(false);
    expect(prefersMarkdown(undefined)).toBe(false);
  });
});
