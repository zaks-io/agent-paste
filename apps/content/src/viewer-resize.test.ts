import { describe, expect, it } from "vitest";
import { VIEWER_FRAME_HEIGHT_MESSAGE_TYPE } from "@agent-paste/contracts";
import { injectViewerResizeReporter } from "./viewer-resize.js";

describe("injectViewerResizeReporter", () => {
  it("injects the resize reporter before </body>", () => {
    const html = injectViewerResizeReporter("<html><head></head><body><p>tall</p></body></html>");
    expect(html).toContain(VIEWER_FRAME_HEIGHT_MESSAGE_TYPE);
    expect(html).toContain("<script>");
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("</body>"));
  });

  it("appends the reporter when no body tag exists", () => {
    const html = injectViewerResizeReporter("<p>fragment</p>");
    expect(html.endsWith("</script>")).toBe(true);
    expect(html).toContain(VIEWER_FRAME_HEIGHT_MESSAGE_TYPE);
  });

  it("is idempotent when the reporter is already present", () => {
    const once = injectViewerResizeReporter("<html><body></body></html>");
    expect(injectViewerResizeReporter(once)).toBe(once);
  });
});
