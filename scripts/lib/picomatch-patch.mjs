// @ts-check
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix, resolve } from "node:path";
import { parse } from "yaml";

const patches = {
  "2.3.2": {
    patch: "86a04a2f952e69d16469a541adacff57744457626ede5078a8d58227f867077b",
    parser: "5afb6f8658017f5dc62c7800410f44723bd30a3b1c1d1f2ccd3437830c09a3ee",
    runtime: "2e96d8a62b663decff1fd2b8429b44d0694f552fb32d282ddd7c778f52f0c148",
  },
  "4.0.4": {
    patch: "2f81dd7db0d560ea6217271b602cb3f35b6968cbbab93f8fa859fc7865ada511",
    parser: "8910ec561081e0ec16d2dda4a25513805759a9f78f29194048f3caabe7c6e4ae",
    runtime: "a5a2b8534bfe8bfe92c93133a04b8e5e2b0d66bbd228a3a56be3ffece97110ac",
  },
  "4.0.7": {
    patch: "a7fe1d1bf56620d20545087d980a5fb58959bb79b63bc900ebd9a9ba5e4e0434",
    parser: "2ca4cf3aae7635fc647695b6987ec65df74affae9ba49109496af8fe477ebeac",
    runtime: "f9f556f3bdb5ac4188b0c68da4e86eca6760e9dbf09c6672075958b81df85ccd",
  },
};
const patchPath = (version) => `patches/picomatch@${version}.patch`;
const patched = (version) => {
  assert(Object.hasOwn(patches, version), `Unreviewed picomatch version: ${version}`);
  return `picomatch@${version}(patch_hash=${patches[version].patch})`;
};
const registrations = Object.fromEntries(Object.keys(patches).map((v) => [`picomatch@${v}`, patchPath(v)]));
const onlyPicomatch = (entries) =>
  Object.fromEntries(Object.entries(entries ?? {}).filter(([k]) => k.startsWith("picomatch")));
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

// Reviewed report paths, not a package-wide exception. Versions come from the verified install.
const webConsumers = [
  ["@tanstack/start-plugin-core", "picomatch"],
  ["@tanstack/router-utils", "tinyglobby", "picomatch"],
  ["@tanstack/router-utils", "tinyglobby", "fdir", "picomatch"],
  ["@tanstack/start-plugin-core", "@tanstack/router-plugin", "unplugin", "picomatch"],
  ["@tanstack/start-plugin-core", "@tanstack/router-plugin", "unplugin", "vite", "picomatch"],
];
export const picomatchConsumers = [
  { workspace: "apps/evals", chain: ["@daytona/sdk", "fast-glob", "micromatch", "picomatch"] },
  ...[[], ["@workos/authkit-tanstack-react-start"]].flatMap((prefix) =>
    webConsumers.map((tail) => ({
      workspace: "apps/web",
      chain: [...prefix, "@tanstack/react-start", "@tanstack/react-start-rsc", ...tail],
    })),
  ),
];
const reason =
  "Verified pnpm patches reject every plus/star extglob before regex compilation, including with maxExtglobRecursion:false. Normal globs and negate, optional, and single-choice extglobs remain supported. No fixed upstream release exists for CVE-2026-112366.";

function record(value, label, fields) {
  assert(value && typeof value === "object" && !Array.isArray(value), `Malformed ${label}`);
  if (fields)
    assert(
      Object.keys(value).every((key) => fields.includes(key)),
      `Unreviewed ${label} field`,
    );
  return value;
}

// Registry aliases lock as real-name@version. Validate peer suffixes as well as direct edges.
function identity(name, reference) {
  assert.equal(typeof reference, "string", `Malformed locked reference: ${name}`);
  const base = reference.split("(")[0];
  let depth = 0;
  for (const char of reference.slice(base.length)) {
    assert(depth > 0 || char === "(", `Malformed peer suffix: ${reference}`);
    depth += char === "(" ? 1 : char === ")" ? -1 : 0;
  }
  assert.equal(depth, 0, `Malformed peer suffix: ${reference}`);
  const key = base.includes("@") ? reference : `${name}@${reference}`;
  assert(
    /^(@[^/@:]+\/)?[^@/:]+@\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(key.split("(")[0]),
    `Non-registry reference: ${key}`,
  );
  assert(name !== "picomatch" || key.startsWith("picomatch@"), `Unexpected picomatch alias: ${key}`);
  for (const match of key.matchAll(/(?:^|\()(picomatch@([^()]+)(\(patch_hash=([^()]+)\))?)/g)) {
    assert.equal(match[1], patched(match[2]), `Unpatched picomatch reference: ${key}`);
  }
  return key;
}

/** Parse every active importer/snapshot edge, including aliases and optional/peer copies.
 * @param {string} lock
 */
export function verifyLockedPicomatchPatch(lock) {
  const data = parse(lock);
  assert.equal(data?.lockfileVersion, "9.0", "Unsupported lockfile version");
  const expected = Object.fromEntries(
    Object.keys(patches).map((v) => [`picomatch@${v}`, { hash: patches[v].patch, path: patchPath(v) }]),
  );
  assert.deepEqual(onlyPicomatch(data.patchedDependencies), expected, "Missing locked picomatch patch");
  for (const [key, entry] of Object.entries(record(data.packages, "packages"))) {
    const value = record(entry, "package", [
      "resolution",
      "engines",
      "cpu",
      "os",
      "libc",
      "hasBin",
      "deprecated",
      "bundledDependencies",
      "peerDependencies",
      "peerDependenciesMeta",
    ]);
    assert.deepEqual(
      Object.keys(record(value.resolution, "resolution")),
      ["integrity"],
      `Non-registry resolution: ${key}`,
    );
    assert.equal(typeof value.resolution.integrity, "string", `Malformed integrity: ${key}`);
    if (key.startsWith("picomatch@")) patched(key.slice("picomatch@".length));
  }
  /** @type {Map<string, Array<{name: string, target: string}>>} */
  const graph = new Map();
  const importers = record(data.importers, "importers");
  for (const path of Object.keys(importers)) {
    assert(
      !posix.isAbsolute(path) && !path.split("/").includes("..") && posix.normalize(path) === path,
      `Invalid importer: ${path}`,
    );
  }
  for (const key of Object.keys(record(data.snapshots, "snapshots"))) identity("", key);
  for (const [key, entry] of [
    ...Object.entries(importers).map(([k, v]) => [`link:${k}`, v]),
    ...Object.entries(record(data.snapshots, "snapshots")),
  ]) {
    const importer = key.startsWith("link:");
    const fields = importer
      ? ["dependencies", "devDependencies", "optionalDependencies"]
      : ["dependencies", "optionalDependencies", "transitivePeerDependencies", "optional"];
    const value = record(entry, "dependency owner", fields);
    const edges = [];
    for (const section of fields.filter((field) => field.endsWith("Dependencies") || field === "dependencies")) {
      if (section === "transitivePeerDependencies") continue;
      for (const [name, ref] of Object.entries(value[section] ?? {})) {
        const reference = importer ? record(ref, "importer dependency", ["specifier", "version"]).version : ref;
        const target =
          importer && typeof reference === "string" && reference.startsWith("link:")
            ? `link:${posix.normalize(posix.join(key.slice(5), reference.slice(5)))}`
            : identity(name, reference);
        edges.push({ name, target });
      }
    }
    graph.set(key, edges);
  }
  for (const edges of graph.values())
    for (const { target } of edges) assert(graph.has(target), `Missing locked dependency: ${target}`);
  assert.deepEqual(
    [...graph.keys()].filter((key) => key.startsWith("picomatch@")).sort(),
    Object.keys(patches).map(patched).sort(),
    "Unexpected picomatch snapshots",
  );
  return graph;
}

function installedDependency(manifest, name) {
  const found = (createRequire(manifest).resolve.paths(name) ?? [])
    .map((path) => join(path, name, "package.json"))
    .find(existsSync);
  assert(found, `Missing installed dependency ${name} from ${manifest}`);
  return realpathSync(found);
}

function verifyInstalledCopy(manifest) {
  const { name, version } = json(manifest);
  assert.equal(name, "picomatch");
  patched(version);
  const directory = dirname(manifest);
  assert.equal(
    digest(join(directory, "lib/parse.js")),
    patches[version].parser,
    "Installed picomatch parser differs from patch",
  );
  // Include entry points and package.json so a changed main/exports cannot bypass the parser.
  const files = [
    "package.json",
    ...readdirSync(directory).filter((f) => f.endsWith(".js")),
    ...readdirSync(join(directory, "lib"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => `lib/${f}`),
  ].sort();
  const hash = createHash("sha256");
  for (const file of files)
    hash
      .update(file)
      .update("\0")
      .update(readFileSync(join(directory, file)))
      .update("\0");
  assert.equal(hash.digest("hex"), patches[version].runtime, "Installed picomatch runtime differs from patch");
  const picomatch = createRequire(manifest)(directory);
  for (const pattern of ["+(*a)", "*(a|aa)"]) {
    assert.throws(() => picomatch(pattern, { maxExtglobRecursion: false }), {
      name: "SyntaxError",
      message: "Repeated extglobs are disabled",
    });
  }
  assert(picomatch("**/*.{js,ts}")("src/index.ts"));
  return directory;
}

function verifyInstalledGraph(repoRoot, graph) {
  const relevant = new Set([...graph.keys()].filter((key) => key.startsWith("picomatch@")));
  let previous;
  do {
    previous = relevant.size;
    for (const [key, edges] of graph) if (edges.some(({ target }) => relevant.has(target))) relevant.add(key);
  } while (relevant.size !== previous);
  const queue = [...graph.keys()]
    .filter((key) => key.startsWith("link:") && relevant.has(key))
    .map((key) => ({ key, manifest: resolve(repoRoot, key.slice(5), "package.json") }));
  const visited = new Set();
  const copies = new Set();
  const targets = new Set();
  for (const { key, manifest } of queue) {
    const visit = `${key}\0${manifest}`;
    if (visited.has(visit)) continue;
    visited.add(visit);
    if (!key.startsWith("link:")) {
      const { name, version } = json(manifest);
      assert.equal(`${name}@${version}`, key.split("(")[0], `Installed dependency differs from lock: ${manifest}`);
    }
    if (key.startsWith("picomatch@")) {
      copies.add(verifyInstalledCopy(manifest));
      targets.add(key);
    }
    for (const { name, target } of graph.get(key)) {
      if (relevant.has(target)) queue.push({ key: target, manifest: installedDependency(manifest, name) });
    }
  }
  assert.deepEqual(
    [...targets].sort(),
    Object.keys(patches).map(patched).sort(),
    "Locked picomatch copy is not installed",
  );
  return [...copies].sort();
}

/** Fail closed before the exact version-only Snyk finding can receive a disposition.
 * @param {string} repoRoot
 */
export function verifyPicomatchPatch(repoRoot) {
  for (const [version, hashes] of Object.entries(patches))
    assert.equal(digest(join(repoRoot, patchPath(version))), hashes.patch, "Unexpected picomatch patch bytes");
  const workspace = parse(readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8"));
  assert.deepEqual(
    onlyPicomatch(workspace.patchedDependencies),
    registrations,
    "Missing workspace picomatch patch registration",
  );
  assert.deepEqual(
    onlyPicomatch(json(join(repoRoot, "package.json")).pnpm?.patchedDependencies),
    registrations,
    "Missing manifest picomatch patch registration",
  );
  const graphs = ["pnpm-lock.yaml", "node_modules/.pnpm/lock.yaml"].map((path) =>
    verifyLockedPicomatchPatch(readFileSync(join(repoRoot, path), "utf8")),
  );
  assert.deepEqual(graphs[0], graphs[1], "Installed and committed lock graphs differ");
  const verifiedCopies = verifyInstalledGraph(repoRoot, graphs[0]);
  const allowedFindings = picomatchConsumers.map(({ workspace: path, chain }) => {
    let manifest = join(repoRoot, path, "package.json");
    let key = `link:${path}`;
    const versioned = () => {
      const { name, version } = json(manifest);
      return version ? `${name}@${version}` : name;
    };
    const from = [versioned()];
    for (const name of chain) {
      const edge = graphs[0].get(key)?.find((edge) => edge.name === name);
      assert(edge, `Missing locked Snyk consumer: ${key} ${name}`);
      key = edge.target;
      manifest = installedDependency(manifest, name);
      assert.equal(versioned(), key.split("(")[0], "Snyk consumer differs from lock");
      from.push(versioned());
    }
    assert(verifiedCopies.includes(dirname(manifest)), "Snyk path resolves an unverified picomatch copy");
    return {
      id: "SNYK-JS-PICOMATCH-21248802",
      module: "picomatch",
      version: json(manifest).version,
      target: join(path, "package.json"),
      paths: [from],
      reason,
    };
  });
  return { hashes: patches, verifiedCopies, allowedFindings };
}
