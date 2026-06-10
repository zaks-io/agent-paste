#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const options = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const wantedNode = readFileSync(join(root, ".nvmrc"), "utf8").trim();
const packageManager = packageJson.packageManager ?? "pnpm@latest";
const pnpmVersion = packageManager.startsWith("pnpm@") ? packageManager.slice("pnpm@".length) : "";
const wantedNodeMajor = Number.parseInt(wantedNode, 10);

main();

function main() {
  process.chdir(root);

  const source = options.source ? resolve(options.source) : defaultSourceWorktree();
  if (!options.skipEnv) {
    copyEnvFiles(source);
  }

  if (!options.skipInstall) {
    ensureNodeVersion();
    run("corepack", ["enable"]);
    if (pnpmVersion) {
      run("corepack", ["prepare", `pnpm@${pnpmVersion}`, "--activate"]);
    }
    run("pnpm", ["install", "--frozen-lockfile", "--strict-peer-dependencies"]);
    run("pnpm", ["hooks:install"]);
  }

  log("Worktree setup complete.");
}

function copyEnvFiles(source) {
  const files = source ? envFilesIn(source) : [];

  if (files.length === 0) {
    log(source ? `No env files found in ${source}.` : "No source worktree found for env files.");
    copyExampleEnv();
    return;
  }

  log(`Copying env files from ${source}`);
  for (const file of files) {
    const from = join(source, file);
    const to = join(root, file);
    if (existsSync(to) && !options.force) {
      log(`  skip ${file} (already exists; pass --force to overwrite)`);
      continue;
    }
    if (options.dryRun) {
      log(`  would copy ${file}`);
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    log(`  copied ${file}`);
  }

  if (!files.includes(".env") && !existsSync(join(root, ".env"))) {
    copyExampleEnv();
  }
}

function copyExampleEnv() {
  const target = join(root, ".env");
  const example = join(root, ".env.example");
  if (existsSync(target) || !existsSync(example)) {
    return;
  }
  if (options.dryRun) {
    log("  would create .env from .env.example");
    return;
  }
  copyFileSync(example, target);
  log("  created .env from .env.example");
}

function envFilesIn(source) {
  if (!existsSync(source)) {
    return [];
  }
  const files = new Set();
  for (const file of rootEnvFilesIn(source)) {
    files.add(file);
  }

  const output = spawnSync("git", ["-C", source, "status", "--ignored", "--short", "--untracked-files=all"], {
    encoding: "utf8",
    // 16x Node's default buffer for repos with many ignored or untracked files.
    maxBuffer: 16 * 1024 * 1024,
  });
  if (output.status !== 0) {
    return [...files].sort();
  }

  for (const line of output.stdout.split(/\r?\n/)) {
    const path = line.slice(3).trim();
    if (!path || path.endsWith("/")) {
      continue;
    }
    if (isEnvFile(path) && isRegularFile(join(source, path))) {
      files.add(path);
    }
  }
  return [...files].sort();
}

function rootEnvFilesIn(source) {
  return readdirSync(source)
    .filter(isEnvFile)
    .filter((file) => isRegularFile(join(source, file)));
}

function isEnvFile(path) {
  const name = path.split("/").at(-1) ?? "";
  if (name === ".env.example" || name.endsWith(".example")) {
    return false;
  }
  return name === ".env" || name.startsWith(".env.") || name === ".dev.vars" || name.startsWith(".dev.vars.");
}

function defaultSourceWorktree() {
  const current = realPathish(root);

  // The main checkout owns the real .git directory; linked worktrees only carry
  // a gitdir pointer. Its parent is the canonical source for env files no matter
  // what the repo is named or where it lives on disk.
  const commonDir = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: root,
    encoding: "utf8",
  });
  if (commonDir.status === 0) {
    const mainCheckout = dirname(commonDir.stdout.trim());
    if (mainCheckout && realPathish(mainCheckout) !== current && isDirectory(mainCheckout)) {
      return mainCheckout;
    }
  }

  // Fallback: any sibling worktree that still has env files to offer.
  const output = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" });
  if (output.status !== 0) {
    return undefined;
  }

  const worktrees = output.stdout
    .split(/\n(?=worktree )/)
    .map((entry) => entry.match(/^worktree (.+)$/m)?.[1])
    .filter(Boolean)
    .map((path) => resolve(path));

  return worktrees.find((path) => realPathish(path) !== current);
}

function ensureNodeVersion() {
  const actualMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
  if (!wantedNodeMajor || actualMajor === wantedNodeMajor) {
    return;
  }
  const message = `Node ${wantedNode}.x is required, but this process is using ${process.version}.`;
  if (options.dryRun) {
    log(`warning: ${message}`);
    return;
  }
  if (process.env.WORKTREE_SETUP_NODE_REEXEC !== "1") {
    const installedNode = findInstalledNode(wantedNodeMajor);
    if (installedNode) {
      reexecWithNode(installedNode);
    }
    const nvmNode = installWithNvm();
    if (nvmNode) {
      reexecWithNode(nvmNode);
    }
  }
  throw new Error(`${message} Run \`nvm install && nvm use\` or equivalent, then re-run \`pnpm setup:worktree\`.`);
}

function findInstalledNode(major) {
  const nvmRoot = process.env.NVM_DIR ?? (process.env.HOME ? join(process.env.HOME, ".nvm") : undefined);
  if (!nvmRoot) {
    log("warning: NVM_DIR and HOME are unset; cannot search for an installed Node version.");
    return undefined;
  }
  const versionsDir = join(nvmRoot, "versions", "node");
  if (!major || !existsSync(versionsDir)) {
    return undefined;
  }

  const versions = readdirSync(versionsDir)
    .map((name) => ({ name, parsed: parseNodeVersion(name) }))
    .filter((entry) => entry.parsed?.major === major)
    .sort((left, right) => compareVersions(right.parsed, left.parsed));

  for (const entry of versions) {
    const nodePath = join(versionsDir, entry.name, "bin", "node");
    if (isRegularFile(nodePath)) {
      return nodePath;
    }
  }
  return undefined;
}

function installWithNvm() {
  const script = [
    'export NVM_DIR="$HOME/.nvm"',
    '[ -s "$NVM_DIR/nvm.sh" ]',
    '. "$NVM_DIR/nvm.sh"',
    `nvm install ${shellQuote(wantedNode)}`,
    `nvm which ${shellQuote(wantedNode)}`,
  ].join(" && ");
  const result = spawnSync("bash", ["-lc", script], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    if (result.stderr.trim()) {
      process.stderr.write(result.stderr);
    }
    return undefined;
  }
  return result.stdout.trim().split(/\r?\n/).at(-1);
}

function reexecWithNode(nodePath) {
  const nodeBin = dirname(nodePath);
  const env = {
    ...process.env,
    WORKTREE_SETUP_NODE_REEXEC: "1",
    PATH: [nodeBin, process.env.PATH].filter(Boolean).join(":"),
  };
  log(`Re-running setup with ${nodePath}`);
  const result = spawnSync(nodePath, [process.argv[1], ...process.argv.slice(2)], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

function parseNodeVersion(name) {
  const match = name.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return undefined;
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function compareVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function run(command, args) {
  if (options.dryRun) {
    log(`would run: ${[command, ...args].join(" ")}`);
    return;
  }
  log(`running: ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { cwd: root, env: commandEnv(), stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function commandEnv() {
  if (process.stdin.isTTY || process.env.CI !== undefined) {
    return process.env;
  }
  return { ...process.env, CI: "true" };
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    force: false,
    skipEnv: false,
    skipInstall: false,
    source: process.env.WORKTREE_SETUP_SOURCE,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--skip-env") {
      parsed.skipEnv = true;
    } else if (arg === "--skip-install") {
      parsed.skipInstall = true;
    } else if (arg === "--source") {
      index += 1;
      parsed.source = argv[index];
      if (!parsed.source) {
        throw new Error("Missing value for --source");
      }
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  process.stdout.write(`Usage: pnpm setup:worktree [options]

Sets up a fresh git worktree by copying local env files (.env*, .dev.vars*,
including nested ones like apps/web/.dev.vars) from the main checkout and
installing repo dependencies. The source defaults to the main checkout that
owns the shared .git directory; override with --source or WORKTREE_SETUP_SOURCE.

Options:
  --source <path>   Source checkout to copy .env/.dev.vars files from.
  --force           Overwrite existing env files.
  --skip-env        Do not copy env files.
  --skip-install    Do not install dependencies or hooks.
  --dry-run         Print planned actions without changing files.
`);
}

function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function realPathish(path) {
  return relative("/", resolve(path));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}
