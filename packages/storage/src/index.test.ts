import { describe, expect, it } from "vitest";
import { contentTypeForPath, responseHeadersForPath } from "./index";

describe("storage helpers", () => {
  it("maps known extensions to MIME types", () => {
    expect(contentTypeForPath("docs/readme.md")).toBe("text/markdown; charset=utf-8");
    expect(contentTypeForPath("image.PNG")).toBe("image/png");
    expect(contentTypeForPath("archive.bin")).toBe("application/octet-stream");
  });

  it("adds defensive response headers", () => {
    expect(responseHeadersForPath("app.js")).toMatchObject({
      "Content-Type": "application/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
  });
});
