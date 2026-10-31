import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { resolveBracesConsumer } from "./braces-patch.mjs";
import { evaluatePnpmAuditPolicy } from "./pnpm-audit-policy.mjs";
import { evaluateGrypePolicy } from "./scanner-vulnerability-policy.mjs";
import {
  verifyLockedZodLighthouseConsumers,
  verifyZodLighthouseIsolation,
  zodLighthouseFinding,
} from "./zod-lighthouse-policy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
const chain = ["lighthouse", "puppeteer-core", "chromium-bidi", "zod"];
const [ghsa, cve] = zodLighthouseFinding.vulnerabilityIds;

function auditReport(findings) {
  const advisory = { github_advisory_id: ghsa, module_name: "zod", severity: "high", findings };
  return JSON.stringify({ advisories: { 1243066: advisory } });
}

function grypeReport(version, locations = [{ path: "/pnpm-lock.yaml" }]) {
  return JSON.stringify({
    matches: [
      {
        vulnerability: { id: ghsa, severity: "High" },
        relatedVulnerabilities: [{ id: cve }],
        artifact: { name: "zod", version, locations },
      },
    ],
  });
}

function withLock(mutate) {
  const lockfile = parse(lock);
  mutate(lockfile);
  return stringify(lockfile);
}

describe("Lighthouse Zod 3 isolation", () => {
  it("verifies the pinned chain, sole lock consumers, and that no Zod 3 module loads", () => {
    const result = verifyZodLighthouseIsolation(root);
    expect(result.paths).toEqual(zodLighthouseFinding.paths);
    expect(result.probe.zodModules).toBe(0);
    expect(result.probe.chromiumBidiModules).toBeGreaterThan(0);
  });

  it("rejects a changed package version before the disposition applies", () => {
    const fixture = mkdtempSync(join(tmpdir(), "zod-lighthouse-disposition-"));
    try {
      cpSync(join(root, "package.json"), join(fixture, "package.json"));
      chain.forEach((name, i) => {
        const directory = resolveBracesConsumer(root, { workspace: ".", chain: chain.slice(0, i + 1) });
        mkdirSync(join(fixture, "node_modules", name), { recursive: true });
        cpSync(join(directory, "package.json"), join(fixture, "node_modules", name, "package.json"));
      });
      const manifestPath = join(fixture, "node_modules/puppeteer-core/package.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: "25.13.0" }));
      expect(() => verifyZodLighthouseIsolation(fixture)).toThrow(/Unreviewed Lighthouse Zod dependency path/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("accepts the current lockfile", () => {
    expect(() => verifyLockedZodLighthouseConsumers(lock)).not.toThrow();
  });

  it.each([
    ["zod", "3.25.76", /consumer of zod@3\.25\.76/],
    ["schema-validator", "zod@3.25.76", /consumer of zod@3\.25\.76/],
    ["chromium-bidi", "17.0.2(devtools-protocol@0.0.1666840)", /consumer of chromium-bidi@17\.0\.2/],
    ["puppeteer-core", "25.9.0(yauzl@2.10.0)", /consumer of puppeteer-core@25\.9\.0/],
    ["lighthouse", "13.4.1", /consumer of lighthouse@13\.4\.1/],
  ])("rejects another snapshot depending on %s: %s", (name, reference, message) => {
    for (const section of ["dependencies", "optionalDependencies"]) {
      const mutated = withLock((lockfile) => {
        lockfile.snapshots["rogue@1.0.0"] = { [section]: { [name]: reference } };
      });
      expect(() => verifyLockedZodLighthouseConsumers(mutated)).toThrow(message);
    }
  });

  it("parses quoted lockfile keys and versions", () => {
    const quoted = `${lock}\n  'rogue@1.0.0':\n    dependencies:\n      'zod': '3.25.76'\n`;
    expect(() => verifyLockedZodLighthouseConsumers(quoted)).toThrow(/consumer of zod@3\.25\.76/);
  });

  it.each([
    ["zod", { specifier: "^3.25.0", version: "3.25.76" }, /consumer of zod@3\.25\.76/],
    ["schema-validator", { specifier: "npm:zod@^3.25.0", version: "zod@3.25.76" }, /consumer of zod@3\.25\.76/],
    ["lighthouse", { specifier: "13.4.1", version: "13.4.1" }, /consumer of lighthouse@13\.4\.1/],
  ])("rejects a workspace that depends on %s", (name, entry, message) => {
    const mutated = withLock((lockfile) => {
      lockfile.importers["apps/rogue"] = { dependencies: { [name]: entry } };
    });
    expect(() => verifyLockedZodLighthouseConsumers(mutated)).toThrow(message);
  });

  it.each([
    ["link into the pnpm store", "link:../../node_modules/.pnpm/zod@3.25.76/node_modules/zod", /Unreviewed local link/],
    ["absolute link", "link:/repo/packages/contracts", /Unreviewed local link/],
    ["tarball", "https://registry.example/zod/-/zod-3.25.76.tgz", /Unreviewed non-registry lockfile reference/],
    ["git reference", "github.com/colinhacks/zod/abc123", /Unreviewed non-registry lockfile reference/],
  ])("rejects a workspace %s reference", (_kind, version, message) => {
    const mutated = withLock((lockfile) => {
      lockfile.importers["apps/web"].dependencies["schema-validator"] = { specifier: version, version };
    });
    expect(() => verifyLockedZodLighthouseConsumers(mutated)).toThrow(message);
  });

  it("rejects a link reference inside a snapshot", () => {
    const mutated = withLock((lockfile) => {
      lockfile.snapshots["rogue@1.0.0"] = { dependencies: { zod: "link:../zod" } };
    });
    expect(() => verifyLockedZodLighthouseConsumers(mutated)).toThrow(/Unreviewed non-registry lockfile reference/);
  });

  it("requires Lighthouse to stay a root devDependency", () => {
    const mutated = withLock(({ importers: { ".": root } }) => {
      root.dependencies = { ...root.dependencies, lighthouse: root.devDependencies.lighthouse };
      delete root.devDependencies.lighthouse;
    });
    expect(() => verifyLockedZodLighthouseConsumers(mutated)).toThrow(/consumer of lighthouse@13\.4\.1/);
  });
});

describe("Lighthouse Zod 3 scanner disposition", () => {
  const [path] = zodLighthouseFinding.paths;
  const auditAllowance = { ghsa, module: "zod", version: "3.25.76", paths: [path], reason: "reviewed" };
  const allowed = {
    ...zodLighthouseFinding,
    targets: zodLighthouseFinding.scannerTargets,
    sourcePaths: zodLighthouseFinding.paths,
  };
  const verifiedSources = [{ vulnerabilityIds: [ghsa], packageName: "zod", paths: [path] }];

  it("allows only the reviewed audit path and version", () => {
    const evaluate = (findings) =>
      evaluatePnpmAuditPolicy(auditReport(findings), { allowedFindings: [auditAllowance] }).status;
    expect(evaluate([{ version: "3.25.76", paths: [path] }])).toBe(0);
    expect(evaluate([{ version: "3.25.76", paths: [path, ".>other>zod"] }])).toBe(1);
    expect(evaluate([{ version: "3.25.75", paths: [path] }])).toBe(1);
  });

  it("allows the Grype match only with a verified source and the reviewed version", () => {
    const evaluate = (version, sources) =>
      evaluateGrypePolicy(grypeReport(version), { allowedFindings: [allowed], verifiedSources: sources }).status;
    expect(evaluate("3.25.76", verifiedSources)).toBe(0);
    expect(evaluate("3.25.76", [])).toBe(1);
    expect(evaluate("3.25.75", verifiedSources)).toBe(1);
  });

  it.each([
    ["an unapproved lockfile", [{ path: "/pnpm-lock.yaml" }, { path: "/apps/rogue/pnpm-lock.yaml" }]],
    ["a non-string path", [{ path: "/pnpm-lock.yaml" }, { path: 42 }]],
    ["a null location", [null, { path: "/pnpm-lock.yaml" }]],
  ])("blocks a Grype match that also reports %s", (_case, locations) => {
    const report = grypeReport("3.25.76", locations);
    expect(evaluateGrypePolicy(report, { allowedFindings: [allowed], verifiedSources }).status).toBe(1);
  });
});
