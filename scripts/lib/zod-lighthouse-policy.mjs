// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBracesConsumer } from "./braces-patch.mjs";

// No Zod 3 release fixes GHSA-mrhx-c7xc-m3w5. Every chromium-bidi release that moved to Zod 4
// lacks the trusted-publisher provenance 17.0.2 has, so trustPolicy: no-downgrade rejects it.
const reviewedChain = ["lighthouse@13.4.1", "puppeteer-core@25.9.0", "chromium-bidi@17.0.2", "zod@3.25.76"];
const chainNames = reviewedChain.map((entry) => entry.slice(0, entry.lastIndexOf("@")));
const BIDI_BRIDGE = "lib/puppeteer/bidi/bidi.js";

export const zodLighthouseFinding = {
  vulnerabilityIds: ["GHSA-mrhx-c7xc-m3w5", "CVE-2023-54404"],
  packageName: "zod",
  version: "3.25.76",
  paths: [[".", ...chainNames].join(">")],
  scannerTargets: ["pnpm-lock.yaml"],
  reason:
    "Lighthouse is a root devDependency used only by CI accessibility checks. Only chromium-bidi's in-browser protocol parser imports this Zod 3 copy; puppeteer-core's Node BiDi bridge uses the no-op parser and Lighthouse connects over CDP. The pinned chain, sole lock consumers, and a load probe that resolves no Zod module are verified.",
};

/** Each reviewed package may be the only snapshot that depends on the next one,
 * because another consumer could load chromium-bidi's Zod-backed parser.
 * @param {string} lock pnpm-lock.yaml or node_modules/.pnpm/lock.yaml text
 */
export function verifyLockedZodLighthouseConsumers(lock) {
  const [importers = "", snapshots = ""] = lock.split("\nsnapshots:\n");
  assert(!/^ {6}zod:\n {8}specifier: .+\n {8}version: 3\./m.test(importers), "Unreviewed workspace Zod 3 dependency");
  const entries = snapshots.split(/\n(?= {2}\S)/).map((entry) => entry.split("\n"));
  for (let i = 1; i < reviewedChain.length; i++) {
    const [name, version] = [chainNames[i], reviewedChain[i].slice(chainNames[i].length + 1)];
    const dependency = new RegExp(`^ {6}${name}: ${version.replaceAll(".", "\\.")}(\\(|$)`);
    const dependents = entries
      .filter((lines) => lines.slice(1).some((line) => dependency.test(line)))
      .map(([key]) =>
        key
          .trim()
          .replace(/^'|':$|:$/g, "")
          .replace(/\(.*$/, ""),
      );
    assert.deepEqual(dependents, [reviewedChain[i - 1]], `Unreviewed locked consumer of ${reviewedChain[i]}`);
  }
}

/** Fail closed before scanners may dispose of the Lighthouse Zod 3 advisory.
 * @param {string} repoRoot
 */
export function verifyZodLighthouseIsolation(repoRoot) {
  const directories = chainNames.map((_, i) =>
    resolveBracesConsumer(repoRoot, { workspace: ".", chain: chainNames.slice(0, i + 1) }),
  );
  directories.forEach((directory, i) => {
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    assert.equal(`${manifest.name}@${manifest.version}`, reviewedChain[i], "Unreviewed Lighthouse Zod dependency path");
  });
  for (const path of ["pnpm-lock.yaml", "node_modules/.pnpm/lock.yaml"]) {
    verifyLockedZodLighthouseConsumers(readFileSync(join(repoRoot, path), "utf8"));
  }
  const [, puppeteer, chromiumBidi, zod] = directories;
  const probe = spawnSync(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      createRequire(join(repoRoot, "package.json")).resolve("lighthouse"),
      join(puppeteer, BIDI_BRIDGE),
      chromiumBidi,
      zod,
    ],
    { cwd: repoRoot, encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(probe.status, 0, `Lighthouse load probe failed: ${probe.stderr || probe.signal}`);
  const [chromiumBidiModules, zodModules] = JSON.parse(probe.stdout);
  // The bridge must load chromium-bidi, or the probe is not observing the BiDi path at all.
  assert(chromiumBidiModules > 0, "Lighthouse load probe did not observe chromium-bidi");
  assert.equal(zodModules, 0, "Lighthouse dependency chain loaded Zod 3");
  return { paths: zodLighthouseFinding.paths, chain: reviewedChain, probe: { chromiumBidiModules, zodModules } };
}

/** Child process: load Lighthouse and puppeteer-core's BiDi bridge, then count modules
 * resolved inside each watched package directory.
 * @param {string[]} args
 */
async function probeModuleLoads([lighthouseEntry, bidiBridge, ...watched]) {
  const prefixes = watched.map((directory) => `${pathToFileURL(directory).href}/`);
  const resolved = watched.map(() => new Set());
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      for (const [i, prefix] of prefixes.entries()) {
        if (result.url.startsWith(prefix)) resolved[i].add(result.url);
      }
      return result;
    },
  });
  await import(pathToFileURL(lighthouseEntry).href);
  await import(pathToFileURL(bidiBridge).href);
  process.stdout.write(JSON.stringify(resolved.map((urls) => urls.size)));
}

if (import.meta.main) {
  await probeModuleLoads(process.argv.slice(2));
}
