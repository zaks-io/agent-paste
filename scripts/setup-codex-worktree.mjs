#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
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

  log("Codex worktree setup complete.");
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
  const output = spawnSync("git", ["-C", source, "status", "--ignored", "--short", "--untracked-files=all"], {
    encoding: "utf8",
  });
  if (output.status !== 0) {
    return [];
  }

  const files = new Set();
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

function isEnvFile(path) {
  const name = path.split("/").at(-1) ?? "";
  if (name === ".env.example" || name.endsWith(".example")) {
    return false;
  }
  return name === ".env" || name.startsWith(".env.") || name === ".dev.vars" || name.startsWith(".dev.vars.");
}

function defaultSourceWorktree() {
  const output = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" });
  if (output.status !== 0) {
    return undefined;
  }

  const current = realPathish(root);
  const worktrees = output.stdout
    .split(/\n(?=worktree )/)
    .map((entry) => entry.match(/^worktree (.+)$/m)?.[1])
    .filter(Boolean)
    .map((path) => resolve(path));

  return (
    worktrees.find((path) => realPathish(path) !== current && !path.includes("/.codex/worktrees/")) ??
    worktrees.find((path) => realPathish(path) !== current)
  );
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
  if (process.env.CODEX_SETUP_NODE_REEXEC !== "1" && reexecWithNvm()) {
    process.exit(0);
  }
  throw new Error(`${message} Run \`nvm install && nvm use\` or equivalent, then re-run \`pnpm setup:codex\`.`);
}

function reexecWithNvm() {
  const script = [
    'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
    '[ -s "$NVM_DIR/nvm.sh" ]',
    '. "$NVM_DIR/nvm.sh"',
    `nvm install ${shellQuote(wantedNode)}`,
    `CODEX_SETUP_NODE_REEXEC=1 nvm exec ${shellQuote(wantedNode)} node ${[process.argv[1], ...process.argv.slice(2)].map(shellQuote).join(" ")}`,
  ].join(" && ");
  const result = spawnSync("bash", ["-lc", script], { cwd: root, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    return false;
  }
  return true;
}

function run(command, args) {
  if (options.dryRun) {
    log(`would run: ${[command, ...args].join(" ")}`);
    return;
  }
  log(`running: ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    force: false,
    skipEnv: false,
    skipInstall: false,
    source: process.env.CODEX_SETUP_SOURCE_WORKTREE,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
  process.stdout.write(`Usage: pnpm setup:codex [options]

Sets up a fresh Codex worktree by copying local env files from another worktree
and installing repo dependencies.

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

function realPathish(path) {
  return relative("/", resolve(path));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}
