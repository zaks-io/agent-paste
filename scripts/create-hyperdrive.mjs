#!/usr/bin/env node
// Hyperdrive must use the app_role connection string (DATABASE_URL_RUNTIME_* /
// PR runtime Neon URL). Never pass migration URLs (platform_admin) here.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { maskConnectionUri } from "../packages/db/scripts/credentials.mjs";
import { findHyperdriveByName } from "./lib/hyperdrive-list.mjs";
import { spawnCommand } from "./lib/spawn-command.mjs";

if (isMain(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

async function runCli() {
  loadDotenv();
  const options = parseArgs(process.argv.slice(2));
  const connectionString = process.env[options.connectionStringEnv];
  if (!connectionString) {
    throw new Error(`Set ${options.connectionStringEnv}.`);
  }

  const id = await createOrRefreshHyperdrive(
    { name: options.name, connectionString },
    { run: spawnCommand, log: (message) => process.stdout.write(message) },
  );
  emitOutput(options.githubOutput, id);
  process.stdout.write(`Hyperdrive ${options.name}: ${id}\n`);
}

export async function createOrRefreshHyperdrive(options, dependencies = {}) {
  const run = dependencies.run ?? spawnCommand;
  const log = dependencies.log ?? (() => {});
  const existing = await findHyperdriveByName(run, options.name);
  return existing
    ? await refreshHyperdrive(run, log, existing.id, options.name, options.connectionString)
    : await createHyperdrive(run, log, options.name, options.connectionString);
}

async function createHyperdrive(run, log, name, connectionString) {
  const args = ["exec", "wrangler", "hyperdrive", "create", name, "--connection-string", connectionString];
  const result = await run("pnpm", args, { allowFailure: true, quiet: true });
  if (result.code !== 0) {
    if (isHyperdriveNameConflict(result)) {
      const existing = await findHyperdriveByName(run, name);
      if (existing) {
        log(`Hyperdrive ${name} already exists (${existing.id}); updating existing config.\n`);
        return refreshHyperdrive(run, log, existing.id, name, connectionString);
      }
    }
    throw new Error(commandFailureMessage("pnpm", args, result));
  }
  const match = result.stdout.match(/Created new Hyperdrive PostgreSQL config:\s*([0-9a-f-]+)/i);
  if (!match) {
    throw new Error(`Could not parse Hyperdrive id from wrangler output:\n${result.stdout || result.stderr}`);
  }
  log(`Created Hyperdrive ${name} (${match[1]}) for ${maskConnectionUri(connectionString)}\n`);
  return match[1];
}

async function refreshHyperdrive(run, log, id, name, connectionString) {
  const args = ["exec", "wrangler", "hyperdrive", "update", id, "--connection-string", connectionString];
  const result = await run("pnpm", args, { allowFailure: true, quiet: true });
  if (result.code !== 0) {
    throw new Error(commandFailureMessage("pnpm", args, result));
  }
  log(`Updated Hyperdrive ${name} (${id}) to ${maskConnectionUri(connectionString)}\n`);
  return id;
}

function isHyperdriveNameConflict(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return output.includes("[code: 2017]") || output.toLowerCase().includes("given name already exists");
}

function commandFailureMessage(command, args, result) {
  return `${command} ${args.slice(0, 3).join(" ")} exited ${result.code}\n${
    result.stderr?.trim() || result.stdout?.trim()
  }`.trimEnd();
}

function emitOutput(name, value) {
  if (!name) {
    return;
  }
  process.stdout.write(`${name}=${value}\n`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

function parseArgs(argv) {
  const name = stringOption(argv, "--name");
  const connectionStringEnv = stringOption(argv, "--connection-string-env") ?? "DATABASE_URL";
  const githubOutput = stringOption(argv, "--github-output");
  if (!name) {
    throw new Error("Set --name.");
  }
  return { name, connectionStringEnv, githubOutput };
}

function stringOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function loadDotenv() {
  if (!existsSync(".env")) {
    return;
  }
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = unquote(rawValue);
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function isMain(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl);
}
