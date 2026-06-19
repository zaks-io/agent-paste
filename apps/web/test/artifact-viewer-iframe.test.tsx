// @ts-nocheck
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArtifactViewerIframe } from "../src/components/artifacts/ArtifactViewerIframe";

describe("ArtifactViewerIframe", () => {
  it("renders a sandboxed iframe that can scroll tall content", () => {
    render(<ArtifactViewerIframe src="https://content.test/v/token/index.html" />);
    const iframe = screen.getByTitle("Artifact content");
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe.getAttribute("src")).toBe("https://content.test/v/token/index.html");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-popups");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe.className).toContain("overflow-auto");
    expect(iframe.className).toContain("h-full");
    expect(iframe.className).toContain("w-full");
  });
});
