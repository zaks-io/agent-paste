import { describe, expect, it } from "vitest";
import { cssVarsBlock, DARK, fontFaceCss, LIGHT, OPERATING_COMPANY, themeOverrideCss, themeVarLines } from "./index.js";

describe("brand tokens", () => {
  it("keeps the one vermilion accent in both themes", () => {
    expect(DARK.accent).toBe("10 100% 54%");
    expect(LIGHT.accent).toBe("10 100% 54%");
  });

  it("dark canvas is a neutral near-black", () => {
    expect(DARK.background).toBe("240 6% 5%");
  });

  it("exports the official operating company", () => {
    expect(OPERATING_COMPANY).toEqual({
      name: "Zaks.io, LLC",
      href: "https://zaks.io",
    });
  });
});

describe("cssVarsBlock", () => {
  const css = cssVarsBlock();

  it("emits a light :root and a dark media override", () => {
    expect(css).toContain(":root {");
    expect(css).toContain("@media (prefers-color-scheme: dark) {");
  });

  it("maps the accent and canvas onto the expected var names", () => {
    expect(css).toContain("--accent: 10 100% 54%;"); // vermilion, both themes
    expect(css).toContain("--background: 240 6% 5%;"); // dark canvas
  });

  it("binds --primary to the foreground for the high-contrast neutral button", () => {
    expect(themeVarLines("dark")["--primary"]).toBe(DARK.foreground);
    expect(themeVarLines("light")["--primary"]).toBe(LIGHT.foreground);
  });
});

describe("themeOverrideCss", () => {
  const css = themeOverrideCss();

  it("emits attribute-selector blocks for a manual light/dark toggle", () => {
    expect(css).toContain('[data-theme="light"] {');
    expect(css).toContain('[data-theme="dark"] {');
    // Carries the same tokens so the override is complete, not partial.
    expect(css).toContain(`--background: ${DARK.background};`);
    expect(css).toContain(`--background: ${LIGHT.background};`);
  });
});

describe("fontFaceCss", () => {
  const css = fontFaceCss();

  it("declares the three self-hosted variable faces", () => {
    expect(css).toContain('font-family: "Cabinet Grotesk";');
    expect(css).toContain('font-family: "Switzer";');
    expect(css).toContain('font-family: "Spline Sans Mono";');
    expect(css).toContain("/fonts/CabinetGrotesk-Variable.woff2");
    expect(css).toContain("/fonts/Switzer-Variable.woff2");
    expect(css).toContain("/fonts/SplineSansMono-Variable.woff2");
    expect(css).toContain('format("woff2")');
  });

  it("respects a custom base path", () => {
    expect(fontFaceCss("/assets/fonts")).toContain("/assets/fonts/CabinetGrotesk-Variable.woff2");
  });
});
