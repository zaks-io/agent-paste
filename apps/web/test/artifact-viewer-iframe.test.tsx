// @ts-nocheck

import { VIEWER_FRAME_HEIGHT_MESSAGE_TYPE } from "@agent-paste/contracts";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArtifactViewerIframe } from "../src/components/artifacts/ArtifactViewerIframe";

describe("ArtifactViewerIframe", () => {
  it("renders a sandboxed iframe with viewport fill until height is reported", () => {
    render(<ArtifactViewerIframe src="https://content.test/v/token/index.html" />);
    const iframe = screen.getByTitle("Artifact content");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-popups");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe.style.height).toBe("100%");
  });

  it("sizes the iframe when a validated postMessage arrives from the sandboxed iframe", () => {
    render(<ArtifactViewerIframe src="https://content.test/v/token/index.html" />);
    const iframe = screen.getByTitle("Artifact content");
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: window,
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: VIEWER_FRAME_HEIGHT_MESSAGE_TYPE, height: 3200 },
          origin: "null",
          source: window,
        }),
      );
    });

    expect(iframe.style.height).toBe("3200px");
    expect(iframe.style.minHeight).toBe("3200px");
  });

  it("accepts a later larger height when late-loading content grows the document", () => {
    render(<ArtifactViewerIframe src="https://content.test/v/token/index.html" />);
    const iframe = screen.getByTitle("Artifact content");
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: window,
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: VIEWER_FRAME_HEIGHT_MESSAGE_TYPE, height: 800 },
          origin: "null",
          source: window,
        }),
      );
    });
    expect(iframe.style.height).toBe("800px");

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: VIEWER_FRAME_HEIGHT_MESSAGE_TYPE, height: 3200 },
          origin: "null",
          source: window,
        }),
      );
    });
    expect(iframe.style.height).toBe("3200px");
    expect(iframe.style.minHeight).toBe("3200px");
  });

  it("ignores postMessage from unexpected origins or sources", () => {
    render(<ArtifactViewerIframe src="https://content.test/v/token/index.html" />);
    const iframe = screen.getByTitle("Artifact content");
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: {},
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: VIEWER_FRAME_HEIGHT_MESSAGE_TYPE, height: 3200 },
          origin: "https://evil.test",
          source: window,
        }),
      );
    });

    expect(iframe.style.height).toBe("100%");
  });
});
