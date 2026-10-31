// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
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
    "Lighthouse is a root devDependency used only by CI accessibility checks. Only chromium-bidi's in-browser protocol parser imports this Zod 3 copy; puppeteer-core's Node BiDi bridge uses the no-op parser and Lighthouse connects over CDP. The pinned chain, a single locked consumer per hop from the root devDependency, and a load probe that resolves no Zod module are verified.",
};

// pnpm audit deduplicates visited packages, so a second consumer can hide behind the reviewed
// path. The root devDependency must be the only entry into the chain, and each reviewed package
// the only consumer of the next.
const reviewedDependents = [". devDependencies", ...reviewedChain.slice(0, -1)];
const importerSections = ["dependencies", "devDependencies", "optionalDependencies"];
const snapshotSections = ["dependencies", "optionalDependencies"];

const REGISTRY_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Resolve a locked reference to a registry identity or a workspace link. Links outside the
 * workspace and file, tarball, or git references could hide a consumer from pnpm audit, so
 * they fail closed until this disposition is reviewed for them.
 * @param {string} name dependency key, or "" for a snapshot key
 * @param {unknown} reference locked version, alias target, link, or peer-suffixed key
 * @param {{ importer: string, importerPaths: Set<string> }} [workspace] set for importer edges
 */
function packageIdentity(name, reference, workspace) {
  assert.equal(typeof reference, "string", `Malformed locked reference for ${name}`);
  const raw = String(reference);
  // Validate the whole link path: parentheses inside a path are not a peer suffix.
  if (workspace && raw.startsWith("link:")) {
    const target = posix.normalize(posix.join(workspace.importer, raw.slice("link:".length)));
    assert(
      !raw.startsWith("link:/") && workspace.importerPaths.has(target),
      `Unreviewed local link ${name}: ${reference} in ${workspace.importer}`,
    );
    return `link:${target}`;
  }
  const resolved = raw.replace(/\(.*$/, "");
  // Aliased dependencies lock as `alias: real-name@version`.
  const alias = resolved.match(/^((?:@[^/@:]+\/)?[^@/:]+)@(.+)$/);
  const [packageName, version] = alias ? [alias[1], alias[2]] : [name, resolved];
  assert(REGISTRY_VERSION.test(version), `Unreviewed non-registry lockfile reference ${name}: ${reference}`);
  return `${packageName}@${version}`;
}

/** @param {unknown} value @param {string} label */
function lockedRecord(value, label) {
  if (value === undefined) return {};
  assert(value && typeof value === "object" && !Array.isArray(value), `Malformed lockfile ${label}`);
  return /** @type {Record<string, any>} */ (value);
}

/** Verify every importer and snapshot edge into the reviewed chain, including aliases.
 * @param {string} lock pnpm-lock.yaml or node_modules/.pnpm/lock.yaml text
 */
export function verifyLockedZodLighthouseConsumers(lock) {
  const lockfile = parse(lock);
  assert.equal(lockfile?.lockfileVersion, "9.0", "Unsupported lockfile version");
  /** @type {Array<[string, string]>} */
  const edges = [];
  const importers = lockedRecord(lockfile.importers, "importers");
  const importerPaths = new Set(Object.keys(importers));
  for (const [path, importer] of Object.entries(importers)) {
    for (const section of importerSections) {
      for (const [name, entry] of Object.entries(lockedRecord(importer?.[section], `${path} ${section}`))) {
        edges.push([`${path} ${section}`, packageIdentity(name, entry?.version, { importer: path, importerPaths })]);
      }
    }
  }
  for (const [key, snapshot] of Object.entries(lockedRecord(lockfile.snapshots, "snapshots"))) {
    const dependent = packageIdentity("", key);
    for (const section of snapshotSections) {
      for (const [name, reference] of Object.entries(lockedRecord(snapshot?.[section], `${key} ${section}`))) {
        edges.push([dependent, packageIdentity(name, reference)]);
      }
    }
  }
  reviewedChain.forEach((identity, i) => {
    const dependents = [...new Set(edges.filter(([, target]) => target === identity).map(([from]) => from))];
    assert.deepEqual(dependents.sort(), [reviewedDependents[i]], `Unreviewed locked consumer of ${identity}`);
  });
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
