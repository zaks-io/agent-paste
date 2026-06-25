import { VIEWER_FRAME_HEIGHT_MESSAGE_TYPE } from "@agent-paste/contracts";
import { describe, expect, it } from "vitest";
import { injectViewerResizeReporter, VIEWER_END_MARKER_ID, viewerResizeReporterScriptSha256 } from "./viewer-resize.js";

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

  it("is idempotent when the end marker is already present", () => {
    const once = injectViewerResizeReporter("<html><body></body></html>");
    expect(injectViewerResizeReporter(once)).toBe(once);
  });

  it("still injects when publisher HTML mentions the postMessage type", () => {
    const html = injectViewerResizeReporter(
      `<html><body><code>${VIEWER_FRAME_HEIGHT_MESSAGE_TYPE}</code></body></html>`,
    );
    expect(html).toContain(`id="${VIEWER_END_MARKER_ID}"`);
    expect(html.match(/<script>/g)?.length).toBe(1);
  });

  it("inserts before the last </body> when earlier body-close tokens appear in strings", () => {
    const html = injectViewerResizeReporter('<html><body><script>var x = "</body>";</script><p>tall</p></body></html>');
    const markerIndex = html.indexOf(`id="${VIEWER_END_MARKER_ID}"`);
    const lastBodyIndex = html.toLowerCase().lastIndexOf("</body>");
    expect(markerIndex).toBeGreaterThan(-1);
    expect(markerIndex).toBeLessThan(lastBodyIndex);
    expect(html.indexOf('var x = "</body>"')).toBeLessThan(markerIndex);
  });
});

describe("viewerResizeReporterScriptSha256", () => {
  it("returns a stable base64 digest for the injected reporter source", async () => {
    const hash = await viewerResizeReporterScriptSha256();
    expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(await viewerResizeReporterScriptSha256()).toBe(hash);
  });
});
