import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bracesConsumers, bracesFinding, resolveBracesConsumer, verifyBracesPatch } from "./braces-patch.mjs";
import { evaluatePnpmAuditPolicy } from "./pnpm-audit-policy.mjs";
import { evaluateGrypePolicy, evaluateTrivyPolicy } from "./scanner-vulnerability-policy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const allowed = { ...bracesFinding, targets: bracesFinding.scannerTargets, sourcePaths: bracesFinding.paths };
const verified = [{ ...allowed, paths: bracesFinding.paths }];
const auditAllowance = {
  ghsa: bracesFinding.vulnerabilityIds[0],
  module: bracesFinding.packageName,
  version: bracesFinding.version,
  paths: bracesFinding.paths,
  reason: bracesFinding.reason,
};
const report = (finding) =>
  JSON.stringify({
    advisories: {
      1: {
        github_advisory_id: auditAllowance.ghsa,
        module_name: "braces",
        severity: "high",
        ...finding,
      },
    },
  });

function installedFixture() {
  const fixture = mkdtempSync(join(tmpdir(), "braces-verification-"));
  for (const file of ["patches", "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"]) {
    cpSync(join(root, file), join(fixture, file), { recursive: true });
  }
  const store = join(fixture, "node_modules/.pnpm");
  mkdirSync(store, { recursive: true });
  cpSync(join(root, "node_modules/.pnpm/lock.yaml"), join(store, "lock.yaml"));
  const patched = verifyBracesPatch(root).verifiedCopies[0];
  const copied = join(store, patched.split("/node_modules/.pnpm/")[1]);
  mkdirSync(join(copied, ".."), { recursive: true });
  symlinkSync(patched, copied);
  for (const { workspace, chain } of bracesConsumers) {
    mkdirSync(join(fixture, workspace), { recursive: true });
    cpSync(join(root, workspace, "package.json"), join(fixture, workspace, "package.json"));
    for (const name of chain.slice(0, -1)) {
      const directory = join(fixture, "node_modules", name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "package.json"), JSON.stringify({ name }));
    }
  }
  return { fixture, patched };
}

describe("installed braces depth mitigation", () => {
  it("verifies the exact registered patch, locked references, installed parser, and every consumer", () => {
    expect(verifyBracesPatch(root).paths).toEqual(bracesFinding.paths);
  });

  it.each(bracesConsumers)("preserves ordinary patterns through $workspace/$chain", (consumer) => {
    const braces = createRequire(join(resolveBracesConsumer(root, consumer), "package.json"))("./index.js");
    for (const [pattern, expanded] of [
      ["a/{b,c}/d", ["a/b/d", "a/c/d"]],
      ["a/{1..5}/b", ["a/1/b", "a/2/b", "a/3/b", "a/4/b", "a/5/b"]],
      ["a/{x,{1..3},y}/z", ["a/x/z", "a/1/z", "a/2/z", "a/3/z", "a/y/z"]],
      ["a/\\{b,c\\}/d", ["a/{b,c}/d"]],
      ["a/{b,c/d", ["a/{b,c/d"]],
      ["a/(b,c)/d", ["a/(b,c)/d"]],
      ["a/{}/d", ["a/{}/d"]],
    ])
      expect(braces.expand(pattern)).toEqual(expanded);
    expect(braces.compile("a/{b,c}/d")).toBe("a/(b|c)/d");
    expect(() => braces.expand(`${"{(".repeat(51)}a${")}".repeat(51)}`)).toThrow(SyntaxError);
    for (const [open, close] of [
      ["{", "}"],
      ["(", ")"],
    ]) {
      const pattern = `${open.repeat(101)}a${close.repeat(101)}`;
      expect(() => braces.parse(pattern, { maxLength: Infinity })).toThrow(/maximum depth 100/);
      expect(() => braces.expand(pattern.slice(0, 102))).toThrow(/maximum depth 100/);
    }
  });

  it("rejects malicious strings through the installed micromatch consumer", () => {
    const finder = createRequire(join(root, "node_modules/jscpd/package.json")).resolve("@jscpd/finder");
    const fastGlob = createRequire(finder).resolve("fast-glob");
    const micromatch = createRequire(fastGlob)("micromatch");
    expect(() => micromatch.braceExpand(`${"{".repeat(4999)}a${"}".repeat(4999)}`)).toThrow(SyntaxError);
    expect(micromatch.braceExpand("a/{b,c}/d")).toEqual(["a/b/d", "a/c/d"]);
  });

  it("fails closed before any allowance when the patch is missing", () => {
    expect(() => verifyBracesPatch(join(root, "apps/cli"))).toThrow();
    expect(() => resolveBracesConsumer(root, { workspace: ".", chain: ["missing-braces-consumer"] })).toThrow();
  });

  it.each([
    ["patches/braces@3.0.3.patch", () => "changed patch"],
    ["pnpm-workspace.yaml", (text) => text.replace("braces@3.0.3:", "braces@3.0.2:")],
    ["pnpm-lock.yaml", (text) => text.replace(/hash: 36ee\w+/, "hash: changed")],
    ["pnpm-lock.yaml", (text) => `${text}\n      braces: 3.0.3\n`],
  ])("rejects altered mitigation configuration in %s", (path, change) => {
    const fixture = mkdtempSync(join(tmpdir(), "braces-verification-"));
    try {
      for (const file of ["patches", "pnpm-workspace.yaml", "pnpm-lock.yaml"]) {
        cpSync(join(root, file), join(fixture, file), { recursive: true });
      }
      const target = join(fixture, path);
      writeFileSync(target, change(readFileSync(target, "utf8")));
      expect(() => verifyBracesPatch(fixture)).toThrow();
    } finally {
      rmSync(fixture, { recursive: true });
    }
  });

  it("ignores an orphan raw store copy while every active consumer resolves the patch", () => {
    const { fixture, patched } = installedFixture();
    try {
      symlinkSync(patched, join(fixture, "node_modules/braces"));
      const orphan = join(fixture, "node_modules/.pnpm/braces@3.0.3/node_modules/braces");
      cpSync(patched, orphan, { recursive: true });
      const parserPath = join(orphan, "lib/parse.js");
      const parser = readFileSync(parserPath, "utf8").replaceAll(
        "      if (stack.length >= 101) {\n        throw new SyntaxError('Nesting exceeds maximum depth 100');\n      }\n",
        "",
      );
      writeFileSync(parserPath, parser);
      expect(parser).not.toContain("Nesting exceeds maximum depth");
      expect(verifyBracesPatch(fixture).inactiveStoreCopies).toEqual(["braces@3.0.3"]);
    } finally {
      rmSync(fixture, { recursive: true });
    }
  });

  it("fails closed if an active consumer resolves an unpatched parser", () => {
    const { fixture, patched } = installedFixture();
    try {
      const active = join(fixture, "node_modules/braces");
      cpSync(patched, active, { recursive: true });
      writeFileSync(join(active, "lib/parse.js"), "module.exports = () => {};\n");
      expect(() => verifyBracesPatch(fixture)).toThrow(/Installed braces parser differs/);
    } finally {
      rmSync(fixture, { recursive: true });
    }
  });
});

describe("patched braces scanner disposition", () => {
  it("accepts only the exact advisory, version, and verified dependency paths", () => {
    const finding = { findings: [{ version: "3.0.3", paths: [bracesFinding.paths[0]] }] };
    const options = { allowedFindings: [auditAllowance] };
    expect(evaluatePnpmAuditPolicy(report(finding), options).status).toBe(0);
    for (const change of [
      { github_advisory_id: "GHSA-other" },
      { module_name: "another-package" },
      { findings: [{ version: "3.0.2", paths: [bracesFinding.paths[0]] }] },
      { findings: [{ paths: [bracesFinding.paths[0]] }] },
      { findings: [{ version: "3.0.3", paths: [".>unknown>braces"] }] },
    ])
      expect(evaluatePnpmAuditPolicy(report({ ...finding, ...change }), options).status).toBe(1);
  });

  it("requires the verified source, exact lock target, and version for Trivy and Grype", () => {
    const trivy = (change = {}, target = "pnpm-lock.yaml") =>
      JSON.stringify({
        Results: [
          {
            Target: target,
            Vulnerabilities: [
              {
                VulnerabilityID: allowed.vulnerabilityIds[1],
                VendorIDs: [allowed.vulnerabilityIds[0]],
                PkgName: "braces",
                InstalledVersion: "3.0.3",
                Severity: "HIGH",
                ...change,
              },
            ],
          },
        ],
      });
    const grype = JSON.stringify({
      matches: [
        {
          vulnerability: { id: allowed.vulnerabilityIds[0], severity: "High" },
          artifact: { name: "braces", version: "3.0.3", locations: [{ path: "/pnpm-lock.yaml" }] },
        },
      ],
    });
    const options = { allowedFindings: [allowed], verifiedSources: verified };
    expect(evaluateTrivyPolicy(trivy(), options).status).toBe(0);
    expect(evaluateGrypePolicy(grype, options).status).toBe(0);
    expect(evaluateTrivyPolicy(trivy(), { allowedFindings: [allowed] }).status).toBe(1);
    expect(evaluateTrivyPolicy(trivy({ InstalledVersion: "3.0.2" }), options).status).toBe(1);
    expect(evaluateTrivyPolicy(trivy({ VulnerabilityID: "CVE-other", VendorIDs: [] }), options).status).toBe(1);
    expect(evaluateTrivyPolicy(trivy({}, "apps/cli/pnpm-lock.yaml"), options).status).toBe(1);
  });
});
