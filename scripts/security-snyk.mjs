#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { bracesConsumers, bracesFinding, verifyBracesPatch } from "./lib/braces-patch.mjs";
import { evaluateSnykPolicy } from "./lib/snyk-vulnerability-policy.mjs";
import { verifyZodBuildConsumers, zodBuildConsumers } from "./lib/zod-build-policy.mjs";
import { verifyZodPatch, zodConsumers } from "./lib/zod-patch.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = join(root, "artifacts/security/snyk");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const rawReport = join(out, "snyk.json");
const writeReport = (name, value) => writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`);

function manifestAt(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function consumerPath({ workspace, chain }) {
  let manifest = join(root, workspace, "package.json");
  const packageName = ({ name, version }) => (version ? `${name}@${version}` : name);
  const path = [packageName(manifestAt(manifest))];
  for (const name of chain) {
    const found = createRequire(manifest)
      .resolve.paths(name)
      .map((directory) => join(directory, name, "package.json"))
      .find(existsSync);
    if (!found) throw new Error(`Missing dependency ${name} from ${manifest}`);
    manifest = realpathSync(found);
    path.push(packageName(manifestAt(manifest)));
  }
  return path;
}

try {
  const verification = verifyBracesPatch(root);
  const zodVerification = verifyZodPatch(root);
  const zodBuildVerification = verifyZodBuildConsumers(root);
  const build = spawnSync(
    "pnpm",
    ["exec", "turbo", "run", "build", "--filter=@agent-paste/contracts^...", "--concurrency=2"],
    { cwd: root, encoding: "utf8" },
  );
  writeFileSync(join(out, "request-array-bounds-build.txt"), `${build.stdout ?? ""}\n${build.stderr ?? ""}`);
  if (build.error || build.status !== 0) throw new Error("Request array bounds dependency build failed");
  const bounds = spawnSync(
    "pnpm",
    [
      "--filter",
      "@agent-paste/contracts",
      "exec",
      "vitest",
      "run",
      "src/request-array-bounds.test.ts",
      "--maxWorkers=2",
    ],
    { cwd: root, encoding: "utf8" },
  );
  writeFileSync(join(out, "request-array-bounds.txt"), `${bounds.stdout ?? ""}\n${bounds.stderr ?? ""}`);
  if (bounds.error || bounds.status !== 0) throw new Error("Request array bounds verification failed");
  writeReport("mitigation.json", { braces: verification, zod: zodVerification, zodBuild: zodBuildVerification });
  const allowedFindings = bracesConsumers.map((consumer) => ({
    id: "SNYK-JS-BRACES-19963945",
    module: bracesFinding.packageName,
    version: bracesFinding.version,
    target: join(consumer.workspace, "package.json"),
    paths: [consumerPath(consumer)],
    reason: bracesFinding.reason,
  }));
  allowedFindings.push(
    ...zodConsumers.map((consumer) => ({
      id: "SNYK-JS-ZOD-20510278",
      module: "zod",
      version: consumer.version,
      target: join(consumer.workspace, "package.json"),
      paths: [consumerPath(consumer)],
      reason:
        "Verified parser patch rejects oversized arrays before element validation; structural request tests require array bounds.",
    })),
  );
  allowedFindings.push(
    ...zodBuildConsumers.map((consumer) => ({
      id: "SNYK-JS-ZOD-20510278",
      module: "zod",
      version: consumer.version,
      target: "apps/web/package.json",
      paths: [consumer.expectedPath],
      reason:
        "Verified TanStack config parsers consume trusted repository build options, outside the production request path.",
    })),
  );
  const expectedTargets = [
    "package.json",
    ...["apps", "packages"].flatMap((directory) =>
      readdirSync(join(root, directory))
        .map((name) => join(directory, name, "package.json"))
        .filter((path) => existsSync(join(root, path))),
    ),
  ];
  const result = spawnSync(
    "pnpm",
    [
      "dlx",
      "snyk@latest",
      "test",
      "--all-projects",
      "--severity-threshold=high",
      "--ignore-policy",
      "--json",
      `--json-file-output=${rawReport}`,
      "--remote-repo-url=https://github.com/zaks-io/agent-paste",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 100 * 1024 * 1024 },
  );
  writeFileSync(join(out, "snyk.stdout.txt"), result.stdout ?? "");
  writeFileSync(join(out, "snyk.stderr.txt"), result.stderr ?? "");
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(`Snyk scanner failed with exit ${result.status}, signal ${result.signal}`);
  }
  const policy = evaluateSnykPolicy(readFileSync(rawReport, "utf8"), {
    repoRoot: root,
    expectedTargets,
    allowedFindings,
  });
  writeReport("policy.json", policy);
  console.log(
    `Snyk scanned ${policy.projectCount} workspaces; ${policy.blocking.length} blocking findings, ${policy.allowed.length} verified patch dispositions. Reports: ${relative(root, out)}`,
  );
  process.exitCode = policy.status;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeReport("failure.json", { error: message });
  console.error(`Snyk security check failed: ${message}`);
  process.exitCode = 1;
}
