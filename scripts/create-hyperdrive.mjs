#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

loadDotenv();
const options = parseArgs(process.argv.slice(2));
const connectionString = process.env[options.connectionStringEnv];
if (!connectionString) {
  throw new Error(`Set ${options.connectionStringEnv}.`);
}

const existing = await findHyperdriveByName(options.name);
const id = existing?.id ?? (await createHyperdrive(options.name, connectionString));
emitOutput(options.githubOutput, id);
process.stdout.write(`Hyperdrive ${options.name}: ${id}\n`);

async function findHyperdriveByName(name) {
  const result = await run("pnpm", ["exec", "wrangler", "hyperdrive", "list"], { allowFailure: true });
  if (result.code !== 0) {
    return null;
  }
  return parseHyperdriveList(result.stdout).find((config) => config.name === name) ?? null;
}

async function createHyperdrive(name, connectionString) {
  const result = await run("pnpm", [
    "exec",
    "wrangler",
    "hyperdrive",
    "create",
    name,
    "--connection-string",
    connectionString,
  ]);
  const match = result.stdout.match(/Created new Hyperdrive PostgreSQL config:\s*([0-9a-f-]+)/i);
  if (!match) {
    throw new Error(`Could not parse Hyperdrive id from wrangler output:\n${result.stdout || result.stderr}`);
  }
  return match[1];
}

function parseHyperdriveList(output) {
  const configs = [];
  for (const line of output.split(/\r?\n/)) {
    const id = line.match(/[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
    if (!id || !line.includes("agent-paste-db-")) {
      continue;
    }
    const name = line.match(/agent-paste-db-[A-Za-z0-9/_-]+/)?.[0];
    if (name) {
      configs.push({ id, name });
    }
  }
  return configs;
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

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code === 0 || options.allowFailure) {
        resolve(result);
      } else {
        reject(new Error(`${command} ${args.slice(0, 3).join(" ")} exited ${result.code}\n${stderr || stdout}`));
      }
    });
  });
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
