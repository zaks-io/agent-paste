import { resolve } from "node:path";
import { globalsCss } from "@agent-paste/brand";
import { expect, it } from "vitest";

/**
 * The shipped stylesheet (`@agent-paste/ui/styles.css`) is a snapshot of
 * @agent-paste/brand's globalsCss(). It is the single file both apps/web and
 * apps/apex import, so the design system cannot drift between surfaces. If the
 * brand tokens change, regenerate with `pnpm --filter @agent-paste/ui test -u`.
 * This snapshot replaces the old per-app brand-tokens-parity test: there is now
 * one generated source, not two hand-authored copies guarded against each other.
 */
it("styles.css is the current generated output of brand globalsCss()", async () => {
  await expect(globalsCss()).toMatchFileSnapshot(resolve(import.meta.dirname, "../src/styles/globals.css"));
});
