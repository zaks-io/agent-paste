import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { resolveBracesConsumer } from "./braces-patch.mjs";
import { picomatchConsumers, verifyLockedPicomatchPatch, verifyPicomatchPatch } from "./picomatch-patch.mjs";
import { evaluateSnykPolicy } from "./snyk-vulnerability-policy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const locked = parse(readFileSync(join(root, "pnpm-lock.yaml"), "utf8"));
const verification = verifyPicomatchPatch(root);
const picomatchKeys = Object.keys(locked.snapshots).filter((key) => key.startsWith("picomatch@"));
const fixtureReport = JSON.parse(readFileSync(join(root, "scripts/fixtures/snyk-workspaces.json"), "utf8"));
const picoFindings = fixtureReport.flatMap((report) =>
  report.vulnerabilities
    .filter((finding) => finding.name === "picomatch")
    .map((finding) => ({ target: report.displayTargetFile, finding })),
);

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function installedFixture() {
  const path = mkdtempSync(join(tmpdir(), "picomatch-verification-"));
  for (const file of ["patches", "package.json", "pnpm-workspace.yaml"])
    cpSync(join(root, file), join(path, file), { recursive: true });
  const data = {
    lockfileVersion: "9.0",
    patchedDependencies: locked.patchedDependencies,
    importers: { ".": { dependencies: {} } },
    packages: {},
    snapshots: {},
  };
  const directories = new Map();
  const add = (key, manifest) => {
    if (directories.has(key)) return;
    const directory = join(path, "installed", String(directories.size));
    directories.set(key, directory);
    data.snapshots[key] = { dependencies: {} };
    data.packages[key.split("(")[0]] = { resolution: { integrity: "fixture" } };
    write(join(directory, "package.json"), JSON.stringify(manifest));
  };
  for (const [i, key] of picomatchKeys.entries()) {
    const copy = verification.verifiedCopies.find((directory) =>
      key.startsWith(`picomatch@${JSON.parse(readFileSync(join(directory, "package.json"))).version}(`),
    );
    add(key, JSON.parse(readFileSync(join(copy, "package.json"))));
    cpSync(copy, directories.get(key), { recursive: true });
    data.importers["."].dependencies[`pico-${i}`] = { specifier: `npm:${key.split("(")[0]}`, version: key };
  }
  for (const { workspace, chain } of picomatchConsumers) {
    cpSync(join(root, workspace, "package.json"), join(path, workspace, "package.json"), { recursive: true });
    data.importers[workspace] ??= { dependencies: {} };
    let dependencies = data.importers[workspace].dependencies;
    for (let i = 0; i < chain.length; i++) {
      const manifest = JSON.parse(
        readFileSync(join(resolveBracesConsumer(root, { workspace, chain: chain.slice(0, i + 1) }), "package.json")),
      );
      const raw = `${manifest.name}@${manifest.version}`;
      const key = manifest.name === "picomatch" ? picomatchKeys.find((key) => key.startsWith(`${raw}(`)) : raw;
      add(key, { name: manifest.name, version: manifest.version });
      dependencies[chain[i]] = i === 0 ? { specifier: manifest.version, version: key } : key;
      dependencies = data.snapshots[key].dependencies;
    }
  }
  const link = (owner, name, target) => {
    const destination = join(owner, "node_modules", name);
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(directories.get(target), destination);
  };
  for (const [workspace, entry] of Object.entries(data.importers))
    for (const [name, ref] of Object.entries(entry.dependencies)) link(join(path, workspace), name, ref.version);
  for (const [key, entry] of Object.entries(data.snapshots))
    for (const [name, target] of Object.entries(entry.dependencies)) link(directories.get(key), name, target);
  const save = () => {
    for (const file of ["pnpm-lock.yaml", "node_modules/.pnpm/lock.yaml"]) write(join(path, file), stringify(data));
  };
  save();
  return { path, data, directories, save };
}

function child(code, args) {
  const result = spawnSync(process.execPath, ["--input-type=commonjs", "-e", code, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 3000,
    killSignal: "SIGKILL",
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.signal, result.stderr).toBeNull();
  expect(result.status, result.stderr).toBe(0);
}

describe("installed picomatch repeated extglob mitigation", () => {
  it("verifies all three hashes, registrations, both YAML graphs and actual installed copies", () => {
    expect(verification.verifiedCopies).toHaveLength(3);
    expect(Object.keys(verification.hashes)).toEqual(["2.3.2", "4.0.4", "4.0.7"]);
    expect(verification.allowedFindings).toHaveLength(11);
  });

  it.each(verification.verifiedCopies)("rejects attacks in a bounded child through %s", (directory) => {
    child(
      `
      const assert = require('node:assert/strict');
      const pico = require(process.argv[1]);
      const attacks = ['+(*a)', '*(*a)', '+(a|aa)', '*(a|aa)', '+(a)', '*(a)', '!(@(x|+(*a)))', 'src/**/+(*a).js', '+('.repeat(100) + 'a' + ')'.repeat(100)];
      for (const options of [{}, {maxExtglobRecursion:false}, {maxExtglobRecursion:Infinity}, {fastpaths:false}, {strict:false}]) {
        for (const pattern of attacks) {
          // A removed mitigation must reach the expensive match and hit the subprocess timeout.
          let matcher;
          try { matcher = pico(pattern, options); } catch (error) { assert(error instanceof SyntaxError); }
          if (matcher) { matcher('a'.repeat(300) + '!'); assert.fail('Repeated extglob accepted'); }
          for (const operation of [pico, pico.makeRe, pico.parse]) {
            assert.throws(() => operation(pattern, options), {name:'SyntaxError', message:'Repeated extglobs are disabled'});
          }
        }
      }
    `,
      [directory],
    );
  });

  it.each(
    verification.verifiedCopies,
  )("preserves ordinary, negate, optional and single-choice patterns through %s", (directory) => {
    const pico = createRequire(join(directory, "package.json"))(directory);
    for (const [pattern, input, match] of [
      ["**/*.{js,ts}", "src/index.ts", true],
      ["src/**/test?.js", "src/a/test1.js", true],
      ["!*.test.js", "index.js", true],
      ["!*.test.js", "index.test.js", false],
      ["!(foo).js", "bar.js", true],
      ["!(foo).js", "foo.js", false],
      ["?(foo).js", ".js", true],
      ["?(foo).js", "foo.js", true],
      ["@(foo|bar).js", "bar.js", true],
      ["@(foo|bar).js", "baz.js", false],
      ["[ab]?.js", "a1.js", true],
      ["\\+\\(foo\\)", "+(foo)", true],
    ])
      expect(pico(pattern, { dot: true })(input), `${pattern} ${input}`).toBe(match);
    expect(pico("+(a)", { noext: true })("+(a)")).toBe(true);
  });

  it.each([
    { workspace: ".", chain: ["jscpd", "@jscpd/finder", "fast-glob"] },
    { workspace: "apps/evals", chain: ["@daytona/sdk", "fast-glob"] },
  ])("exercises actual micromatch and fast-glob consumers in $workspace", (consumer) => {
    const fastGlob = resolveBracesConsumer(root, consumer);
    const directory = mkdtempSync(join(tmpdir(), "picomatch-consumer-"));
    try {
      write(join(directory, "src/a.ts"), "");
      write(join(directory, "src/b.js"), "");
      write(join(directory, "src/a.test.ts"), "");
      child(
        `
        const assert = require('node:assert/strict');
        const {createRequire} = require('node:module');
        const req = createRequire(process.argv[1] + '/package.json');
        const fg = req(process.argv[1]);
        const mm = req('micromatch');
        assert.deepEqual(mm(['a.ts','b.js','a.test.ts'], ['*.{js,ts}','!*.test.ts']), ['a.ts','b.js']);
        assert.deepEqual(fg.sync(['src/**/*.{js,ts}','!**/*.test.ts'], {cwd:process.argv[2]}).sort(), ['src/a.ts','src/b.js']);
        assert.throws(() => mm(['a'.repeat(300)+'!'], '+(*a)'), SyntaxError);
        assert.throws(() => fg.sync('+(*a)', {cwd:process.argv[2]}), SyntaxError);
      `,
        [fastGlob, directory],
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("fail-closed picomatch verification", () => {
  it("accepts quoted YAML and patched alias/importer/optional references", () => {
    const data = structuredClone(locked);
    data.importers["."].optionalDependencies ??= {};
    data.importers["."].optionalDependencies.alias = { specifier: "npm:picomatch@2.3.2", version: picomatchKeys[0] };
    data.snapshots["micromatch@4.0.8"].optionalDependencies = { anotherAlias: picomatchKeys[0] };
    expect(() => verifyLockedPicomatchPatch(stringify(data, { defaultStringType: "QUOTE_DOUBLE" }))).not.toThrow();
  });

  it.each([
    (data) => {
      data.snapshots["micromatch@4.0.8"].dependencies.picomatch = "2.3.2";
    },
    (data) => {
      data.snapshots["micromatch@4.0.8"].dependencies.alias = "picomatch@2.3.2";
    },
    (data) => {
      data.snapshots["micromatch@4.0.8"].optionalDependencies = { alias: "picomatch@2.3.2" };
    },
    (data) => {
      data.importers["."].dependencies = { alias: { specifier: "npm:picomatch@2.3.2", version: "picomatch@2.3.2" } };
    },
    (data) => {
      data.importers["."].devDependencies.picomatch = { specifier: "4.0.7", version: "4.0.7" };
    },
    (data) => {
      data.importers["."].optionalDependencies.alias = { specifier: "npm:picomatch@4.0.7", version: "picomatch@4.0.7" };
    },
    (data) => {
      data.snapshots["fdir@6.5.0(picomatch@4.0.7)"] = {};
    },
    (data) => {
      data.snapshots["picomatch@99.0.0"] = {};
    },
    (data) => {
      data.packages["picomatch@99.0.0"] = { resolution: { integrity: "fixture" } };
    },
    (data) => {
      data.snapshots[picomatchKeys[0]].id = "picomatch@2.3.2";
    },
    (data) => {
      data.importers["."].devDependencies.vitest.version = "4.1.12(unclosed";
    },
    (data) => {
      data.snapshots["micromatch@4.0.8"].dependencies.picomatch = "link:../picomatch";
    },
    (data) => {
      data.patchedDependencies["picomatch@2.3.2"].hash = "other";
    },
    (data) => {
      data.packages["picomatch@2.3.2"].resolution = { directory: "./unpatched" };
    },
  ])("rejects unpatched/unknown/ambiguous locked references %#", (change) => {
    const data = structuredClone(locked);
    change(data);
    expect(() => verifyLockedPicomatchPatch(stringify(data))).toThrow();
  });

  it.each([
    ["patches/picomatch@2.3.2.patch", () => "changed"],
    ["pnpm-workspace.yaml", (text) => text.replace("  picomatch@4.0.7:", "  picomatch@9.0.0:")],
    ["package.json", (text) => text.replace('"picomatch@4.0.4"', '"picomatch@9.0.0"')],
    ["pnpm-lock.yaml", (text) => text.replaceAll(picomatchKeys[0], "picomatch@2.3.2")],
    ["node_modules/.pnpm/lock.yaml", (text) => text.replaceAll(picomatchKeys[0], "picomatch@2.3.2")],
  ])("rejects altered patch registration or either YAML lock in %s", (file, change) => {
    const fixture = installedFixture();
    try {
      const target = join(fixture.path, file);
      const original = readFileSync(target, "utf8");
      const changed = change(original);
      expect(changed).not.toBe(original);
      write(target, changed);
      expect(() => verifyPicomatchPatch(fixture.path)).toThrow();
    } finally {
      rmSync(fixture.path, { recursive: true, force: true });
    }
  });

  it("resolves every copy, including a second alias to a different installed parser", () => {
    const fixture = installedFixture();
    try {
      expect(verifyPicomatchPatch(fixture.path).verifiedCopies).toHaveLength(3);
      const original = fixture.directories.get(picomatchKeys[0]);
      const unpatched = join(fixture.path, "unpatched");
      cpSync(original, unpatched, { recursive: true });
      const alias = join(fixture.path, "node_modules/extra-alias");
      symlinkSync(unpatched, alias);
      fixture.data.importers["."].dependencies["extra-alias"] = {
        specifier: "npm:picomatch@2.3.2",
        version: picomatchKeys[0],
      };
      fixture.save();
      expect(verifyPicomatchPatch(fixture.path).verifiedCopies).toHaveLength(4);
      write(join(unpatched, "lib/parse.js"), "module.exports = () => {};\n");
      expect(() => verifyPicomatchPatch(fixture.path)).toThrow(/parser differs/);
    } finally {
      rmSync(fixture.path, { recursive: true, force: true });
    }
  });

  it("rejects changed entry points despite an intact parser, and ignores inactive store directories", () => {
    const fixture = installedFixture();
    try {
      write(
        join(fixture.path, "node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/parse.js"),
        "unreferenced",
      );
      expect(verifyPicomatchPatch(fixture.path).verifiedCopies).toHaveLength(3);
      write(join(fixture.directories.get(picomatchKeys[0]), "index.js"), "module.exports = () => true;\n");
      expect(() => verifyPicomatchPatch(fixture.path)).toThrow(/runtime differs/);
    } finally {
      rmSync(fixture.path, { recursive: true, force: true });
    }
  });

  it("rejects a named Snyk consumer absent from the lock even if its module still resolves", () => {
    const fixture = installedFixture();
    try {
      delete fixture.data.importers["apps/evals"].dependencies["@daytona/sdk"];
      fixture.save();
      expect(() => verifyPicomatchPatch(fixture.path)).toThrow(/Missing locked Snyk consumer/);
    } finally {
      rmSync(fixture.path, { recursive: true, force: true });
    }
  });

  it("rejects drift between the committed and installed active lock graphs", () => {
    const fixture = installedFixture();
    try {
      fixture.data.importers["."].dependencies.extra = { specifier: "npm:picomatch@2.3.2", version: picomatchKeys[0] };
      write(join(fixture.path, "node_modules/.pnpm/lock.yaml"), stringify(fixture.data));
      expect(() => verifyPicomatchPatch(fixture.path)).toThrow(/lock graphs differ/);
    } finally {
      rmSync(fixture.path, { recursive: true, force: true });
    }
  });

  it.each(["missing", "unknown version"])("rejects an active installed dependency with %s", (change) => {
    const fixture = installedFixture();
    try {
      const copy = fixture.directories.get(picomatchKeys[1]);
      if (change === "missing") rmSync(copy, { recursive: true });
      else {
        const manifest = JSON.parse(readFileSync(join(copy, "package.json"), "utf8"));
        write(join(copy, "package.json"), JSON.stringify({ ...manifest, version: "99.0.0" }));
      }
      expect(() => verifyPicomatchPatch(fixture.path)).toThrow(/Missing installed dependency|differs from lock/);
    } finally {
      rmSync(fixture.path, { recursive: true, force: true });
    }
  });
});

describe("exact picomatch Snyk disposition", () => {
  function policy(target, finding, allowedFindings = verification.allowedFindings) {
    return evaluateSnykPolicy(
      JSON.stringify({
        path: "/fixture/agent-paste/web",
        displayTargetFile: target,
        ok: false,
        vulnerabilities: [finding],
      }),
      { repoRoot: root, expectedTargets: [target], allowedFindings },
    );
  }

  it.each(picoFindings)("accepts the real fixture's full installed chain in $target", ({ target, finding }) => {
    expect(policy(target, finding).status).toBe(0);
    expect(policy(target, finding, []).status).toBe(1);
  });

  it.each([
    { id: "SNYK-JS-PICOMATCH-OTHER" },
    { name: "other" },
    { version: "4.0.4" },
    { from: ["@agent-paste/evals@0.0.0", "picomatch@2.3.2"] },
    { from: picoFindings[0].finding.from.map((entry, i) => (i === 1 ? "@daytona/sdk@99.0.0" : entry)) },
    { from: picoFindings[0].finding.from.map((entry) => entry.split("@")[0]) },
  ])("rejects changed advisory/module/version/chain %#", (change) => {
    expect(policy(picoFindings[0].target, { ...picoFindings[0].finding, ...change }).status).toBe(1);
  });

  it("rejects a known chain reported against another manifest", () => {
    expect(policy("apps/web/package.json", picoFindings[0].finding).status).toBe(1);
  });
});
