#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const outArgIndex = args.indexOf("--out");
const allowedOutBase = resolve(repoRoot, "artifacts/security");
const requestedOut = outArgIndex === -1 ? "artifacts/security" : (args[outArgIndex + 1] ?? "");
const outDir = resolve(repoRoot, requestedOut);

if (outArgIndex !== -1 && !requestedOut) {
  console.error("--out requires a directory");
  process.exit(2);
}

const pathFromAllowedBase = relative(allowedOutBase, outDir);
const isAllowedOutDir =
  pathFromAllowedBase === "" || (!pathFromAllowedBase.startsWith("..") && !isAbsolute(pathFromAllowedBase));
if (isAbsolute(requestedOut) || requestedOut === "." || !isAllowedOutDir) {
  console.error("--out must be artifacts/security or a child directory");
  process.exit(2);
}

rmSync(outDir, { force: true, recursive: true });
mkdirSync(outDir, { recursive: true });

const startedAt = new Date().toISOString();
const steps = [];

function rel(path) {
  return relative(repoRoot, path);
}

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function ensureJsonFile(name, fallback) {
  const path = join(outDir, name);
  if (!existsSync(path)) {
    writeFileSync(path, `${JSON.stringify(fallback, null, 2)}\n`);
  }
}

function runStep(name, command, commandArgs, options = {}) {
  const stdoutPath = options.stdoutFile ? join(outDir, options.stdoutFile) : null;
  const stderrPath = options.stderrFile ? join(outDir, options.stderrFile) : join(outDir, `${name}.stderr.txt`);
  const commandLine = [command, ...commandArgs].join(" ");

  console.log(`\n[security] ${name}: ${commandLine}`);
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
    maxBuffer: 100 * 1024 * 1024,
  });

  if (stdoutPath) {
    writeFileSync(stdoutPath, result.stdout);
  } else if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (stderrPath) {
    writeFileSync(stderrPath, result.stderr);
  } else if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  const status = result.status ?? 1;
  steps.push({
    name,
    command: [command, ...commandArgs],
    status,
    signal: result.signal ?? null,
    stdout: stdoutPath ? rel(stdoutPath) : null,
    stderr: stderrPath ? rel(stderrPath) : null,
  });

  if (status !== 0) {
    console.error(`[security] ${name} failed with exit code ${status}`);
  }

  return status;
}

function runPolicyStep(name, status, details) {
  steps.push({
    name,
    command: [],
    status,
    signal: null,
    stdout: null,
    stderr: null,
    details,
  });
  if (status !== 0) {
    console.error(`[security] ${name} failed`);
  }
}

function enforceSemgrepPolicy() {
  const reportPath = join(outDir, "semgrep.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const results = Array.isArray(report.results) ? report.results : [];
  const blocking = results.filter((result) => result.extra?.severity === "ERROR");
  writeFileSync(
    join(outDir, "semgrep-policy.json"),
    `${JSON.stringify(
      {
        blocking_severities: ["ERROR"],
        finding_count: results.length,
        blocking_count: blocking.length,
        blocking_findings: blocking.map((result) => ({
          check_id: result.check_id,
          path: result.path,
          line: result.start?.line,
          message: result.extra?.message,
        })),
      },
      null,
      2,
    )}\n`,
  );
  runPolicyStep("semgrep-policy", blocking.length === 0 ? 0 : 1, {
    finding_count: results.length,
    blocking_count: blocking.length,
  });
}

function writeAttestation(finishedAt = null) {
  const versions = {
    node: capture("node", ["--version"]),
    pnpm: capture("pnpm", ["--version"]),
    gitleaks: capture("gitleaks", ["version"]),
    checkov: capture("checkov", ["--version"]),
    semgrep: capture("semgrep", ["--version"]),
    trivy: capture("trivy", ["--version"]),
    syft: capture("syft", ["version"]),
    grype: capture("grype", ["version"]),
  };
  const git = {
    commit: capture("git", ["rev-parse", "HEAD"]).stdout,
    branch: capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout,
    status: capture("git", ["status", "--short"]).stdout,
  };
  const failed = steps.filter((step) => step.status !== 0);
  const attestation = {
    schema_version: 1,
    started_at: startedAt,
    finished_at: finishedAt,
    repo_root: repoRoot,
    git,
    policy: {
      dependency_vulnerability_threshold: "moderate/medium",
      checkov_framework: "openapi",
      semgrep_config: "p/default",
      trivy_scanners: "vuln,misconfig",
      gitleaks_scope: "full git history",
      semgrep_blocking_severities: ["ERROR"],
    },
    tools: versions,
    steps,
    passed: finishedAt ? failed.length === 0 : null,
    failed_steps: failed.map((step) => step.name),
  };
  writeFileSync(join(outDir, "attestation.json"), `${JSON.stringify(attestation, null, 2)}\n`);
}

writeAttestation();

runStep("gitleaks", "gitleaks", [
  "git",
  "--no-banner",
  "--redact",
  "--config",
  ".gitleaks.toml",
  "--exit-code",
  "1",
  "--report-format",
  "json",
  "--report-path",
  join(outDir, "gitleaks.json"),
]);
ensureJsonFile("gitleaks.json", []);

runStep("pnpm-audit", "pnpm", ["audit", "--audit-level", "moderate", "--json"], {
  stdoutFile: "pnpm-audit.json",
});

runStep(
  "checkov-openapi",
  "checkov",
  ["-d", "packages/contracts/openapi", "--framework", "openapi", "--quiet", "--compact", "--output", "json"],
  {
    stdoutFile: "checkov-openapi.json",
  },
);

runStep("trivy", "trivy", [
  "fs",
  "--scanners",
  "vuln,misconfig",
  "--include-dev-deps",
  "--severity",
  "MEDIUM,HIGH,CRITICAL",
  "--format",
  "json",
  "--output",
  join(outDir, "trivy.json"),
  "--exit-code",
  "1",
  "--skip-version-check",
  "--skip-dirs",
  "node_modules",
  "--skip-dirs",
  ".git",
  "--skip-dirs",
  ".turbo",
  "--skip-dirs",
  "coverage",
  "--skip-dirs",
  "artifacts",
  "--skip-dirs",
  "dist",
  ".",
]);
ensureJsonFile("trivy.json", {});

runStep("syft", "syft", [
  "dir:.",
  "-o",
  `cyclonedx-json=${join(outDir, "agent-paste.sbom.cdx.json")}`,
  "--exclude",
  "./node_modules",
  "--exclude",
  "./.git",
  "--exclude",
  "./.turbo",
  "--exclude",
  "./coverage",
  "--exclude",
  "./artifacts",
  "--exclude",
  "./dist",
]);

runStep("grype", "grype", [
  `sbom:${join(outDir, "agent-paste.sbom.cdx.json")}`,
  "-o",
  "json",
  "--file",
  join(outDir, "grype.json"),
  "--fail-on",
  "medium",
]);
ensureJsonFile("grype.json", {});

runStep("semgrep", "semgrep", [
  "scan",
  "--config",
  "p/default",
  "--json",
  "--output",
  join(outDir, "semgrep.json"),
  "--exclude",
  "node_modules",
  "--exclude",
  ".turbo",
  "--exclude",
  "coverage",
  "--exclude",
  "artifacts",
  ".",
]);
ensureJsonFile("semgrep.json", {});
enforceSemgrepPolicy();

writeAttestation(new Date().toISOString());

const failed = steps.filter((step) => step.status !== 0);
if (failed.length > 0) {
  console.error(
    `[security] ${failed.length} security attestation step(s) failed: ${failed.map((step) => step.name).join(", ")}`,
  );
  process.exit(1);
}

console.log(`[security] attestation passed; reports written to ${rel(outDir)}`);
