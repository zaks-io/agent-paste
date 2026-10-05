// @ts-check
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const PATCH_PATH = "patches/braces@3.0.3.patch";
const PATCH_SHA256 = "36ee6956e6eb776c159142f683631b4c638917ebf5d04a6a61f9771a119eaa60";
const PARSER_SHA256 = "f4abd91a55191aeb16a28d84f43d2ab57b0f1888e49f7c276c9698bbe11c78c3";
const webChain = ["@tanstack/start-plugin-core", "@tanstack/router-plugin", "chokidar", "braces"];
export const bracesConsumers = [
  { workspace: ".", chain: ["jscpd", "@jscpd/finder", "fast-glob", "micromatch", "braces"] },
  { workspace: "apps/evals", chain: ["@daytona/sdk", "fast-glob", "micromatch", "braces"] },
  { workspace: "apps/web", chain: ["@tanstack/react-start", ...webChain] },
  { workspace: "apps/web", chain: ["@tanstack/react-start", "@tanstack/react-start-rsc", ...webChain] },
  { workspace: "apps/web", chain: ["@workos/authkit-tanstack-react-start", "@tanstack/react-start", ...webChain] },
  {
    workspace: "apps/web",
    chain: ["@workos/authkit-tanstack-react-start", "@tanstack/react-start", "@tanstack/react-start-rsc", ...webChain],
  },
];

export const bracesFinding = {
  vulnerabilityIds: ["GHSA-vfj7-8cjw-p6xm", "CVE-2026-93687"],
  packageName: "braces",
  version: "3.0.3",
  paths: bracesConsumers.map(({ workspace, chain }) => [workspace, ...chain].join(">")),
  scannerTargets: ["pnpm-lock.yaml"],
  reason:
    "The verified pnpm patch caps parsed-string brace/parenthesis nesting at 100 in every installed consumer. Version-only scanners still report 3.0.3; hand-crafted AST inputs are outside this disposition.",
};

/** Resolve the consumer's actual dependency, including packages with export maps.
 * @param {string} repoRoot
 * @param {{ workspace: string, chain: string[] }} consumer
 */
export function resolveBracesConsumer(repoRoot, consumer) {
  let manifest = resolve(repoRoot, consumer.workspace, "package.json");
  for (const name of consumer.chain) {
    const candidates = createRequire(manifest).resolve.paths(name) ?? [];
    const found = candidates.map((path) => join(path, name, "package.json")).find(existsSync);
    assert(found, `Missing installed dependency ${name} from ${manifest}`);
    manifest = realpathSync(found);
  }
  return dirname(manifest);
}

/** Fail closed before scanners may dispose of the version-only advisory.
 * @param {string} repoRoot
 */
export function verifyBracesPatch(repoRoot) {
  const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  assert.equal(digest(join(repoRoot, PATCH_PATH)), PATCH_SHA256, "Unexpected braces patch bytes");
  const workspace = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  assert(workspace.includes(`\n  braces@3.0.3: ${PATCH_PATH}\n`), "Missing pnpm patch registration");
  verifyLockedPatch(readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8"));
  const store = join(repoRoot, "node_modules/.pnpm");
  verifyLockedPatch(readFileSync(join(store, "lock.yaml"), "utf8"));
  const directories = new Set(bracesConsumers.map((consumer) => resolveBracesConsumer(repoRoot, consumer)));
  const patchedCopy = `braces@3.0.3_patch_hash=${PATCH_SHA256}`;
  directories.add(realpathSync(join(store, patchedCopy, "node_modules/braces")));
  for (const directory of directories) {
    assert.equal(digest(join(directory, "lib/parse.js")), PARSER_SHA256, "Installed braces parser differs from patch");
    const require = createRequire(join(directory, "package.json"));
    assert.equal(require(join(directory, "package.json")).version, bracesFinding.version);
    const braces = require(join(directory, "index.js"));
    for (const [open, close] of [
      ["{", "}"],
      ["(", ")"],
    ]) {
      const pattern = `${open.repeat(4999)}a${close.repeat(4999)}`;
      for (const operation of [braces.parse, braces.compile, braces.expand, braces.stringify]) {
        assert.throws(() => operation(pattern), { name: "SyntaxError", message: "Nesting exceeds maximum depth 100" });
      }
      assert.doesNotThrow(() => braces.expand(`${open.repeat(100)}a${close.repeat(100)}`));
    }
    assert.deepEqual(braces.expand("a/{b,c}/d"), ["a/b/d", "a/c/d"]);
  }
  return {
    patchSha256: PATCH_SHA256,
    parserSha256: PARSER_SHA256,
    paths: bracesFinding.paths,
    verifiedCopies: [...directories],
    inactiveStoreCopies: readdirSync(store).filter((name) => name.startsWith("braces@") && name !== patchedCopy),
  };
}

function verifyLockedPatch(lock) {
  assert(
    lock.includes(`  braces@3.0.3:\n    hash: ${PATCH_SHA256}\n    path: ${PATCH_PATH}\n`),
    "Missing locked braces patch",
  );
  const patchedVersion = `3.0.3(patch_hash=${PATCH_SHA256})`;
  const references = [...lock.matchAll(/^\s+braces: (.+)$/gm)].map((match) => match[1]);
  assert(
    references.length > 0 && references.every((version) => version === patchedVersion),
    "Unpatched lock reference",
  );
  const snapshots = lock.split("\nsnapshots:\n")[1] ?? "";
  assert.deepEqual(
    [...snapshots.matchAll(/^ {2}braces@(.+):$/gm)].map((match) => match[1]),
    [patchedVersion],
  );
}
