import { describe, expect, it } from "vitest";
import { cssVarsBlock, DARK, fontFaceCss, grainCss, LIGHT, themeVarLines } from "./index.js";

describe("brand tokens", () => {
  it("keeps the one violet accent in both themes", () => {
    expect(DARK.accent).toBe("248 73% 64%");
    expect(LIGHT.accent).toBe("248 64% 56%");
  });

  it("dark canvas matches the brand mark frame (cool indigo-black)", () => {
    expect(DARK.background).toBe("240 16% 6%");
  });
});

describe("cssVarsBlock", () => {
  const css = cssVarsBlock();

  it("emits a light :root and a dark media override", () => {
    expect(css).toContain(":root {");
    expect(css).toContain("@media (prefers-color-scheme: dark) {");
  });

  it("maps the accent and canvas onto the expected var names", () => {
    expect(css).toContain("--accent: 248 64% 56%;"); // light default
    expect(css).toContain("--accent: 248 73% 64%;"); // dark override
    expect(css).toContain("--background: 240 16% 6%;"); // dark canvas
  });

  it("binds --primary to the foreground for the high-contrast neutral button", () => {
    expect(themeVarLines("dark")["--primary"]).toBe(DARK.foreground);
    expect(themeVarLines("light")["--primary"]).toBe(LIGHT.foreground);
  });
});

describe("fontFaceCss", () => {
  const css = fontFaceCss();

  it("declares Bricolage as a variable font and IBM Plex Mono at 400/500", () => {
    expect(css).toContain('font-family: "Bricolage Grotesque Variable";');
    expect(css).toContain('format("woff2-variations")');
    expect(css).toContain("/fonts/BricolageGrotesque-Variable.woff2");
    expect(css).toContain("/fonts/IBMPlexMono-Regular.woff2");
    expect(css).toContain("/fonts/IBMPlexMono-Medium.woff2");
  });

  it("respects a custom base path", () => {
    expect(fontFaceCss("/assets/fonts")).toContain("/assets/fonts/BricolageGrotesque-Variable.woff2");
  });
});

describe("grainCss", () => {
  it("is a CSP-safe data: URI overlay", () => {
    const css = grainCss();
    expect(css).toContain("body::before");
    // The background image is an inline data: URI, not a remote fetch. (The
    // SVG xmlns http URN inside the data payload is an identifier, not a request.)
    expect(css).toContain('background-image: url("data:image/svg+xml');
    expect(css).not.toMatch(/url\(["']?https?:\/\//);
  });
});
