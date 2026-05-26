import { describe, expect, it } from "vitest";
import { contentTypeForPath, responseHeadersForPath } from "./index";

describe("storage helpers", () => {
  it("maps known extensions to MIME types", () => {
    expect(contentTypeForPath("docs/readme.md")).toBe("text/markdown; charset=utf-8");
    expect(contentTypeForPath("index.htm")).toBe("text/html; charset=utf-8");
    expect(contentTypeForPath("assets/app.js")).toBe("application/javascript; charset=utf-8");
    expect(contentTypeForPath("assets/module.mjs")).toBe("application/javascript; charset=utf-8");
    expect(contentTypeForPath("favicon.ico")).toBe("image/x-icon");
    expect(contentTypeForPath("image.PNG")).toBe("image/png");
    expect(contentTypeForPath("logs/build.LOG")).toBe("text/plain; charset=utf-8");
    expect(contentTypeForPath("fonts/inter.woff")).toBe("font/woff");
    expect(contentTypeForPath("fonts/inter.woff2")).toBe("font/woff2");
    expect(contentTypeForPath("paper.pdf")).toBe("application/pdf");
    expect(contentTypeForPath("audio/clip.mp3")).toBe("audio/mpeg");
    expect(contentTypeForPath("audio/clip.wav")).toBe("audio/wav");
    expect(contentTypeForPath("video/demo.mp4")).toBe("video/mp4");
    expect(contentTypeForPath("video/demo.webm")).toBe("video/webm");
    expect(contentTypeForPath("archive.bin")).toBe("application/octet-stream");
  });

  it("adds defensive response headers", () => {
    expect(responseHeadersForPath("app.js")).toMatchObject({
      "Content-Type": "application/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    expect(responseHeadersForPath("payload.bin")).toMatchObject({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="payload.bin"',
    });
  });
});
