#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { findSecretCollisions, listWorkerSecrets, putWorkerSecret, workerName } from "./wrangler-secrets.mjs";

const WORKOS_SECRETS = {
  "workos-api-key": {
    id: "workos-api-key",
    secretName: "WORKOS_API_KEY",
    bindings: [
      { app: "api", worker: "agent-paste-api" },
      { app: "mcp", worker: "agent-paste-mcp" },
      { app: "upload", worker: "agent-paste-upload" },
      { app: "web", worker: "agent-paste-web" },
    ],
    orderNote: "Write api, mcp, then upload (the MCP bearer verifiers), then web, to narrow mixed-key propagation.",
    drainHint:
      "Verify login (pnpm smoke:web) and the MCP bearer path (pnpm smoke:mcp) plus the target environment smoke after all four writes.",
  },
  "workos-cookie-password": {
    id: "workos-cookie-password",
    secretName: "WORKOS_COOKIE_PASSWORD",
    bindings: [{ app: "web", worker: "agent-paste-web" }],
    orderNote: "Invalidates existing AuthKit dashboard sessions; operators must sign in again.",
    drainHint: "No overlap window — expect immediate session invalidation after deploy.",
  },
};

const ROTATION_AGENT_OPERATOR_ID = "rotation-agent@platform";

const argv = process.argv.slice(2);
const positional = argv.filter((arg) => !arg.startsWith("--"));

try {
  const secretId = positional[0];
  const config = WORKOS_SECRETS[secretId];
  if (!config) {
    usage(`Unknown WorkOS secret ${JSON.stringify(secretId)}.`);
  }
  const target = parseTarget(positional.slice(1));
  const options = parseOptions(argv);
  const value =
    options.value ?? (options.dryRun ? "<from-workos-dashboard>" : await resolveValue(config, target, options));

  const bindings = config.bindings.map((binding) => ({
    worker: workerName(binding.app, target),
    names: [config.secretName],
  }));

  process.stdout.write(formatPlan(config, target, options, value));

  if (options.dryRun || options.printOnly) {
    process.exit(0);
  }

  await assertSafeToWrite(config, target, options, bindings);
  for (const binding of config.bindings) {
    const worker = workerName(binding.app, target);
    process.stderr.write(`Writing ${config.secretName} to ${worker}...\n`);
    await putWorkerSecret(worker, config.secretName, value);
  }

  process.stdout.write("\nWorkOS secret write complete. Run verification smokes with explicit approval.\n");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  usage(message);
}

function formatPlan(config, target, options, valuePlaceholder) {
  const lines = [
    `agent-paste ${target} ${config.id}`,
    `Operator identity (audit): ${options.operator}`,
    "",
    config.orderNote,
    config.drainHint,
    "",
  ];
  for (const binding of config.bindings) {
    lines.push(`  wrangler secret put ${config.secretName} --name ${workerName(binding.app, target)}`);
  }
  lines.push("");
  lines.push(`Value source: ${valuePlaceholder}`);
  lines.push("");
  lines.push("Create or rotate the credential in the WorkOS dashboard before writing Workers.");
  lines.push("For WORKOS_CLIENT_ID swaps, also update apps/api and apps/web wrangler.jsonc vars and deploy.");
  return `${lines.join("\n")}\n`;
}

async function resolveValue(config, _target, options) {
  if (options.value) {
    return options.value;
  }
  if (config.id === "workos-cookie-password") {
    return randomBytes(32).toString("base64url");
  }
  throw new Error(
    `${config.secretName} must be created in the WorkOS dashboard. Re-run with --value <dashboard-secret>.`,
  );
}

async function assertSafeToWrite(config, target, options, bindings) {
  const existingByWorker = new Map();
  for (const binding of bindings) {
    existingByWorker.set(binding.worker, new Set(await listWorkerSecrets(binding.worker)));
  }
  const collisions = findSecretCollisions(bindings, existingByWorker);
  if (collisions.length === 0 || options.force) {
    if (options.force && collisions.length > 0) {
      const phrase = `overwrite ${target} ${config.secretName}`;
      const readline = createInterface({ input: process.stdin, output: process.stderr });
      const answer = await readline.question(`Type "${phrase}" to overwrite: `);
      readline.close();
      if (answer !== phrase) {
        throw new Error("Confirmation did not match; no secrets were written.");
      }
    }
    return;
  }
  throw new Error(
    [
      `Existing ${config.secretName} bindings:`,
      ...collisions.map((name) => `  - ${name}`),
      "",
      "Re-run with --value and --force for intentional rotation.",
    ].join("\n"),
  );
}

function parseTarget(argv) {
  const value = argv.find((arg) => !arg.startsWith("--"));
  if (value !== "preview" && value !== "production") {
    throw new Error("Target environment must be preview or production.");
  }
  return value;
}

function parseOptions(argv) {
  const dryRun = argv.includes("--dry-run");
  const printOnly = argv.includes("--print-only");
  const force = argv.includes("--force");
  const value = stringOption(argv, "--value");
  const operator = stringOption(argv, "--operator") ?? ROTATION_AGENT_OPERATOR_ID;
  if (value !== undefined && value.length === 0) {
    throw new Error("--value must be a non-empty secret.");
  }
  return { dryRun, printOnly, force, value, operator };
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

function usage(message) {
  process.stderr.write(`${message}

Usage:
  node scripts/rotate-workos-secrets.mjs <workos-api-key|workos-cookie-password> <preview|production> [options]

Options:
  --value     Secret from the WorkOS dashboard (required for workos-api-key).
  --operator  Audit identity (default: rotation-agent@platform).
  --dry-run   Print the plan without calling wrangler.
  --print-only  Same as --dry-run.
  --force     Allow overwrite after typed confirmation.

See docs/ops/runbook-rotation.md and docs/ops/runbook-workos.md.
`);
  process.exit(1);
}
