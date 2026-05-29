#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const dependencySections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const requiredCodeScripts = ["build", "lint", "test", "typecheck", "check"];
const requiredWorkerScripts = ["dev", "deploy:preview", "deploy:production", "deploy:live", "typegen"];
const requiredMetadataScripts = ["lint", "check"];

// Packages intentionally published to npm, exempt from the private-by-default rule.
// The CLI is the only artifact meant to ship; everything else stays workspace-internal.
const publishablePackages = new Set(["@zaks-io/agent-paste"]);

const errors = [];

function main() {
  const rootPackage = readJson("package.json");
  const workspaceDirs = listWorkspaceDirs();
  const workspacePackages = workspaceDirs.map((dir) => ({
    dir,
    packageJsonPath: join(dir, "package.json"),
    readmePath: join(dir, "README.md"),
    tsconfigPath: join(dir, "tsconfig.json"),
    wranglerPath: join(dir, "wrangler.jsonc"),
    manifest: readJson(join(dir, "package.json")),
  }));

  validateWorkspacePackages(workspacePackages);
  validateDependencies(workspacePackages, rootPackage);
  validateRootGuardrails();
  const rootReadme = readText("README.md");
  validateRootReadme(rootReadme, rootPackage, workspacePackages);
  validateStaleReadmePhrases(rootReadme, workspacePackages);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`monorepo-policy: ${error}`);
    }
    process.exit(1);
  }

  console.log(`monorepo-policy: checked ${workspacePackages.length} workspace packages`);
}

function listWorkspaceDirs() {
  const dirs = [];
  for (const group of ["apps", "packages"]) {
    const groupPath = pathFromRoot(group);
    for (const entry of readdirSync(groupPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${group}/${entry.name}`;
      if (existsSync(pathFromRoot(dir, "package.json"))) {
        dirs.push(dir);
      }
    }
  }
  return dirs.sort();
}

function validateWorkspacePackages(workspacePackages) {
  const names = new Map();
  for (const pkg of workspacePackages) {
    const { manifest, dir } = pkg;
    requireField(pkg.packageJsonPath, "name", manifest.name);
    if (manifest.name) {
      if (names.has(manifest.name)) {
        errors.push(`${pkg.packageJsonPath}: duplicate package name also used by ${names.get(manifest.name)}`);
      }
      names.set(manifest.name, pkg.packageJsonPath);
    }
    if (manifest.private !== true && !publishablePackages.has(manifest.name)) {
      errors.push(`${pkg.packageJsonPath}: workspace packages must be private`);
    }
    if (manifest.type !== "module") {
      errors.push(`${pkg.packageJsonPath}: workspace packages must set "type": "module"`);
    }
    if (!existsSync(pathFromRoot(pkg.readmePath))) {
      errors.push(`${dir}: missing README.md`);
    }

    const scripts = manifest.scripts ?? {};
    const isCodePackage = existsSync(pathFromRoot(pkg.tsconfigPath));
    const isDeployableWorker = existsSync(pathFromRoot(pkg.wranglerPath));
    const requiredScripts = isCodePackage ? requiredCodeScripts : requiredMetadataScripts;
    for (const script of requiredScripts) {
      if (!scripts[script]) {
        errors.push(`${pkg.packageJsonPath}: missing "${script}" script`);
      }
    }
    if (isDeployableWorker) {
      for (const script of requiredWorkerScripts) {
        if (!scripts[script]) {
          errors.push(`${pkg.packageJsonPath}: deployable Worker missing "${script}" script`);
        }
      }
    }
  }
}

function validateDependencies(workspacePackages, rootPackage) {
  const workspaceNames = new Set(workspacePackages.map((pkg) => pkg.manifest.name));
  const catalogNames = readCatalogNames();
  for (const pkg of [{ packageJsonPath: "package.json", manifest: rootPackage }, ...workspacePackages]) {
    for (const section of dependencySections) {
      const dependencies = pkg.manifest[section] ?? {};
      for (const [name, version] of Object.entries(dependencies)) {
        if (workspaceNames.has(name) && version !== "workspace:*") {
          errors.push(`${pkg.packageJsonPath}: ${section}.${name} must use workspace:*`);
        }
        if (catalogNames.has(name) && version !== "catalog:") {
          errors.push(`${pkg.packageJsonPath}: ${section}.${name} is catalog-managed and must use catalog:`);
        }
      }
    }
  }
}

function validateRootGuardrails() {
  // These guardrails intentionally use exact-string checks against stable repo config.
  // If formatting churn becomes common, replace the YAML/text checks with real parsers.
  const npmrc = readText(".npmrc");
  if (!/^engine-strict=true$/m.test(npmrc)) {
    errors.push(".npmrc: expected engine-strict=true");
  }

  const workspace = readText("pnpm-workspace.yaml");
  for (const expected of ["minimumReleaseAge: 4320", "nodeLinker: isolated", "  - apps/*", "  - packages/*"]) {
    if (!workspace.includes(expected)) {
      errors.push(`pnpm-workspace.yaml: missing ${JSON.stringify(expected)}`);
    }
  }

  const turbo = readJson("turbo.json");
  if (turbo.envMode !== "strict") {
    errors.push('turbo.json: expected envMode "strict"');
  }
  if (turbo.remoteCache?.signature !== true) {
    errors.push("turbo.json: expected signed remote cache");
  }
  if (turbo.futureFlags?.longerSignatureKey !== true) {
    errors.push("turbo.json: expected futureFlags.longerSignatureKey=true");
  }
}

function validateRootReadme(readme, rootPackage, workspacePackages) {
  for (const pkg of workspacePackages) {
    if (!readme.includes(pkg.dir)) {
      errors.push(`README.md: missing workspace path ${pkg.dir}`);
    }
  }
  for (const script of Object.keys(rootPackage.scripts ?? {}).sort()) {
    if (!readme.includes(script)) {
      errors.push(`README.md: missing root script ${script}`);
    }
  }
}

function validateStaleReadmePhrases(rootReadme, workspacePackages) {
  for (const phrase of ["No runtime application code", "prepared for implementation"]) {
    if (rootReadme.includes(phrase)) {
      errors.push(`README.md: stale phrase ${JSON.stringify(phrase)}`);
    }
  }

  const implementedReadmes = implementedReadmesFromRootReadme(rootReadme, workspacePackages);
  for (const pkg of workspacePackages) {
    if (!implementedReadmes.has(pkg.readmePath)) continue;
    const text = readText(pkg.readmePath);
    if (/\bPlanned\b/.test(text)) {
      errors.push(`${pkg.readmePath}: implemented package README still uses "Planned"`);
    }
  }
}

function implementedReadmesFromRootReadme(rootReadme, workspacePackages) {
  const implemented = new Set();
  for (const pkg of workspacePackages) {
    const row = rootReadme.split(/\r?\n/u).find((line) => line.includes(`[\`${pkg.dir}\`]`));
    if (row?.includes("Implemented")) {
      implemented.add(pkg.readmePath);
    }
  }
  return implemented;
}

// Lightweight, dependency-free extraction for the current pnpm-workspace.yaml shape.
// Assumes a top-level "catalog:" section, exactly two-space-indented entries, and
// stops at the next top-level key. Use a YAML parser if this file gets more complex.
function readCatalogNames() {
  const names = new Set();
  const lines = readText("pnpm-workspace.yaml").split(/\r?\n/u);
  let inCatalog = false;
  for (const line of lines) {
    if (line === "catalog:") {
      inCatalog = true;
      continue;
    }
    if (inCatalog && /^[A-Za-z]/u.test(line)) {
      break;
    }
    if (!inCatalog) continue;
    const match = line.match(/^ {2}['"]?([^'":]+)['"]?:/u);
    if (match) {
      names.add(match[1]);
    }
  }
  return names;
}

function requireField(file, field, value) {
  if (value === undefined || value === null || value === "") {
    errors.push(`${file}: missing ${field}`);
  }
}

function readJson(...segments) {
  const path = join(...segments);
  return JSON.parse(readText(path));
}

function readText(...segments) {
  return readFileSync(pathFromRoot(...segments), "utf8");
}

function pathFromRoot(...segments) {
  return join(repoRoot, ...segments);
}

main();
