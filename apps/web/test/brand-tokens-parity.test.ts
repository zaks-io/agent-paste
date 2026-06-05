import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DARK, LIGHT, type ThemeTokens } from "@agent-paste/brand";
import { describe, expect, it } from "vitest";

/**
 * Guard: the authored web stylesheet (globals.css) must agree with the shared
 * @agent-paste/brand tokens. globals.css is the file Tailwind reads; the brand
 * package is the cross-app source of truth. If they drift (the way an emerald
 * landing page once drifted from a violet app), this fails. Fix one or the other
 * on purpose; do not let them diverge silently.
 */

// Resolve relative to this test file, not process.cwd(): the per-package runner
// has cwd = apps/web, but the root coverage runner has cwd = repo root. This file
// lives at apps/web/test/, so globals.css is one directory up under src/styles.
const cssPath = resolve(import.meta.dirname, "../src/styles/globals.css");
const css = readFileSync(cssPath, "utf8");

/** Pull the body of a CSS rule whose selector list contains `selector`. */
function ruleBody(selector: string): string {
  // Matches e.g. `[data-theme="light"] {  ... }` or `:root,\n[data-theme="dark"] { ... }`.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|,|\\s)${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, "m");
  const body = css.match(re)?.[1];
  if (body === undefined) throw new Error(`globals.css: could not find a rule for selector ${selector}`);
  return body;
}

/** Read a single `--name: value;` declaration out of a rule body. */
function cssVar(body: string, name: string): string {
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);`);
  const value = body.match(re)?.[1];
  if (value === undefined) throw new Error(`globals.css: missing --${name}`);
  return value.trim();
}

// The web app authors its dark tokens via the --ink-*/--fg-*/--violet primitives
// in :root, then aliases them. Assert against the resolved primitives so the test
// is robust to the alias layer.
const rootBody = ruleBody(":root");
const lightBody = ruleBody('[data-theme="light"]');

type Check = { name: string; token: keyof ThemeTokens };

const DARK_PRIMITIVE_CHECKS: Array<{ cssName: string; token: keyof ThemeTokens }> = [
  { cssName: "ink-0", token: "background" },
  { cssName: "ink-1", token: "surface" },
  { cssName: "ink-2", token: "surface2" },
  { cssName: "ink-3", token: "surface3" },
  { cssName: "line", token: "rule" },
  { cssName: "line-2", token: "ruleStrong" },
  { cssName: "fg-0", token: "foreground" },
  { cssName: "fg-1", token: "muted" },
  { cssName: "fg-2", token: "subtle" },
  { cssName: "fg-3", token: "faint" },
  { cssName: "violet", token: "accent" },
  { cssName: "violet-dim", token: "accentDim" },
  { cssName: "live", token: "success" },
  { cssName: "warn", token: "warning" },
  { cssName: "gone", token: "destructive" },
];

const LIGHT_CHECKS: Check[] = [
  { name: "background", token: "background" },
  { name: "surface", token: "surface" },
  { name: "surface-2", token: "surface2" },
  { name: "surface-3", token: "surface3" },
  { name: "rule", token: "rule" },
  { name: "rule-strong", token: "ruleStrong" },
  { name: "foreground", token: "foreground" },
  { name: "muted", token: "muted" },
  { name: "subtle", token: "subtle" },
  { name: "faint", token: "faint" },
  { name: "accent", token: "accent" },
  { name: "accent-dim", token: "accentDim" },
  { name: "success", token: "success" },
  { name: "warning", token: "warning" },
  { name: "destructive", token: "destructive" },
];

describe("globals.css matches @agent-paste/brand", () => {
  it.each(DARK_PRIMITIVE_CHECKS)("dark --$cssName == DARK.$token", ({ cssName, token }) => {
    expect(cssVar(rootBody, cssName)).toBe(DARK[token]);
  });

  it.each(LIGHT_CHECKS)("light --$name == LIGHT.$token", ({ name, token }) => {
    expect(cssVar(lightBody, name)).toBe(LIGHT[token]);
  });
});
