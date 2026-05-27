#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import {
  findSecretCollisions,
  listWorkerSecrets,
  putWorkerSecret,
  workerName,
} from "./wrangler-secrets.mjs";

const SECRET_NAME = "STREAM_INTERNAL_SECRET";
const TARGET_APPS = ["api", "stream"];

const target = parseTarget(process.argv.slice(2));
const options = parseOptions(process.argv.slice(2));
const generatedAt = new Date().toISOString();
const secretValue = options.value ?? (options.dryRun ? "<generated>" : secretBytes(32));

const bindings = TARGET_APPS.map((app) => ({
  app,
  worker: workerName(app, target),
  names: [SECRET_NAME],
}));

if (!options.printOnly && !options.dryRun) {
  await assertSafeToWrite();
  for (const binding of bindings) {
    await putWorkerSecret(binding.worker, SECRET_NAME, secretValue);
  }
}

printCaptureBlock();

function parseTarget(argv) {
  const value = argv.find((arg) => !arg.startsWith("--"));
  if (value === "live") {
    return "production";
  }
  if (value !== "preview" && value !== "production") {
    usage("Target environment must be preview or production.");
  }
  return value;
}

function parseOptions(argv) {
  const force = argv.includes("--force");
  const printOnly = argv.includes("--print-only");
  const dryRun = argv.includes("--dry-run");
  const value = stringOption(argv, "--value");
  if (value !== undefined && value.length === 0) {
    usage("--value must be a non-empty secret.");
  }
  return { force, printOnly, dryRun, value };
}

async function assertSafeToWrite() {
  const existingByWorker = new Map();
  for (const binding of bindings) {
    const listed = await listWorkerSecrets(binding.worker);
    existingByWorker.set(binding.worker, new Set(listed));
  }

  const collisions = findSecretCollisions(bindings, existingByWorker);
  if (collisions.length === 0) {
    return;
  }

  if (!options.force) {
    throw new Error(
      [
        `Refusing to overwrite existing ${SECRET_NAME} bindings:`,
        ...collisions.map((name) => `  - ${name}`),
        "",
        "Re-run with --force and type the confirmation if this is an intentional rotation.",
      ].join("\n"),
    );
  }

  const phrase = `overwrite ${target} ${SECRET_NAME}`;
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await readline.question(`Type "${phrase}" to overwrite existing ${SECRET_NAME} secrets: `);
  readline.close();
  if (answer !== phrase) {
    throw new Error("Confirmation did not match; no secrets were written.");
  }
}

function printCaptureBlock() {
  const intro = options.dryRun
    ? "Review this plan before writing secrets."
    : options.printOnly
      ? "Generated value only; no secrets were written."
      : "Capture this value in the password manager before closing this terminal.";
  process.stdout.write(`agent-paste ${target} ${SECRET_NAME} at ${generatedAt}

${intro}
${options.dryRun ? "No secrets were written because --dry-run was set.\n" : ""}
${options.printOnly ? "No secrets were written because --print-only was set.\n" : ""}
${SECRET_NAME}=${options.dryRun ? secretValue : options.printOnly ? secretValue : secretValue}

Workers updated with the same value:
${bindings.map((binding) => `  ${binding.worker}`).join("\n")}
`);
}

function stringOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function secretBytes(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

function usage(message) {
  process.stderr.write(`${message}

Usage:
  node scripts/set-stream-internal-secret.mjs preview
  node scripts/set-stream-internal-secret.mjs production --value <existing-secret>
  node scripts/set-stream-internal-secret.mjs preview --dry-run

Sets the same ${SECRET_NAME} on agent-paste-api-<target> and agent-paste-stream-<target>.
Does not read or rotate any other Worker secrets.

Options:
  --value       Use an existing secret value instead of generating a new one.
  --force       Allow overwriting an existing ${SECRET_NAME} after typed confirmation.
  --dry-run     Print the rollout plan without calling wrangler.
  --print-only  Generate and print a value without calling wrangler.
`);
  process.exit(1);
}
