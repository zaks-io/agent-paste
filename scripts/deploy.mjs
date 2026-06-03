#!/usr/bin/env node
// One command to deploy everything, secrets and all. Per ADR 0078.
//
//   node scripts/deploy.mjs preview
//   node scripts/deploy.mjs production
//
// What it does, machine-to-machine, with NO secret value ever printed or written
// to disk in cleartext:
//   1. For each Worker, lists the secret NAMES it already has (wrangler secret
//      list returns names only — values are never readable).
//   2. Generates random values IN MEMORY only for required symmetric secrets that
//      are missing, and pipes them into `wrangler secret bulk` over stdin.
//   3. Deploys every Worker in dependency order.
//
// Idempotent: a secret that already exists is left untouched, so re-running never
// rotates anything and is always safe. Generation is the ONLY way a value comes
// into being, and it goes straight from randomBytes() to the Worker over a pipe.
// Provider-issued secrets (WORKOS_API_KEY, CF_ACCESS_AUD, WORKOS_COOKIE_PASSWORD)
// are not random and not generated here; if a required one is missing the script
// stops and names it so you can set it from the provider console once.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ensureJobQueues } from "./ensure-job-queues.mjs";
import { hostedJobQueues } from "./hosted-job-queues.mjs";
import { ensureLocalEnvSecrets } from "./lib/local-env-secrets.mjs";
import { secretConsumingApps, secretsForApp } from "./lib/secret-routing.mjs";
import { resolveSecretValue } from "./lib/secret-values.mjs";
import { listWorkerSecrets, workerName } from "./wrangler-secrets.mjs";

const rawTarget = process.argv[2] ?? "preview";
const target = rawTarget === "live" ? "production" : rawTarget;
if (target !== "local" && target !== "preview" && target !== "production") {
  fail("Usage: node scripts/deploy.mjs <local|preview|production>");
}

const root = fileURLToPath(new URL("..", import.meta.url));

// Local is the readable-file environment: generate independent local-only values
// into .env (gitignored) so `pnpm dev:all` runs consistently. No Workers, no
// cloud, no values printed. Roll a secret by deleting its line and re-running.
if (target === "local") {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  const { generated, present } = ensureLocalEnvSecrets(envPath);
  if (generated.length > 0) {
    process.stdout.write(`Wrote ${generated.length} local secret(s) to .env: ${generated.join(", ")}\n`);
  }
  if (present.length > 0) {
    process.stdout.write(`Left ${present.length} existing local secret(s) untouched: ${present.join(", ")}\n`);
  }
  process.stdout.write("Local secrets ready. Run `pnpm dev:all`. No values were displayed.\n");
  process.exit(0);
}

// Random/symmetric secrets this script may generate. Anything not listed here is
// provider-issued and must already exist on the Worker.
const GENERATABLE = new Set([
  "CONTENT_SIGNING_SECRET",
  "UPLOAD_SIGNING_SECRET",
  "ARTIFACT_BYTES_ENCRYPTION_KEY",
  "API_KEY_PEPPER_V1",
  "SMOKE_HARNESS_SECRET",
  "EPHEMERAL_POW_SECRET",
  "STREAM_INTERNAL_SECRET",
]);

// Deploy order: stream/api first (service bindings), web last.
const APPS = ["stream", "api", "upload", "content", "jobs", "mcp", "apex", "web"];

// Shared secrets must hold the SAME value across every Worker that consumes them
// (e.g. CONTENT_SIGNING_SECRET is minted on api/upload and verified on content).
// Generate one value per name, reuse it everywhere.
const generatedValues = new Map();

process.stdout.write(`Deploying agent-paste to ${target}.\n\n`);

process.stdout.write(`Ensuring hosted ${target} Cloudflare Queues exist...\n`);
await ensureJobQueues(hostedJobQueues(target).creationOrder);

const provisionPlan = await buildProvisionPlan();
reportMissingProviderSecrets(provisionPlan);

for (const app of APPS) {
  const worker = workerName(app, target);
  const toSet = provisionPlan.get(app) ?? [];
  if (toSet.length > 0) {
    process.stdout.write(`Provisioning ${worker} secrets: ${toSet.join(", ")}\n`);
    await bulkSetSecrets(worker, toSet);
  }
  process.stdout.write(`Deploying ${worker}...\n`);
  await deployApp(app);
  process.stdout.write("\n");
}

process.stdout.write(`${target} deploy complete. No secret values were displayed.\n`);

// --- planning -------------------------------------------------------------

async function buildProvisionPlan() {
  const plan = new Map();
  const missingProvider = [];
  for (const app of secretConsumingApps()) {
    const worker = workerName(app, target);
    const existing = new Set(await listWorkerSecretsSafe(worker));
    const needed = secretsForApp(app, target);
    const toSet = [];
    for (const name of needed) {
      if (existing.has(name)) {
        continue;
      }
      // Prefer a value supplied by the environment (CI / GitHub environment
      // secrets); otherwise generate random material for symmetric secrets.
      // Provider-issued secrets with no env value can't be invented: name them.
      if (resolveSecretValue(name, target) !== undefined || GENERATABLE.has(name)) {
        toSet.push(name);
      } else if (isRequired(app, name)) {
        missingProvider.push(`${worker}:${name}`);
      }
    }
    if (toSet.length > 0) {
      plan.set(app, toSet);
    }
  }
  plan.missingProvider = missingProvider;
  return plan;
}

function reportMissingProviderSecrets(plan) {
  if (!plan.missingProvider || plan.missingProvider.length === 0) {
    return;
  }
  fail(
    `These required provider-issued secrets are missing and cannot be generated:\n` +
      plan.missingProvider.map((entry) => `  - ${entry}`).join("\n") +
      `\n\nSet each once with (value piped, never typed inline):\n` +
      `  printf %s '<value-from-provider-console>' | pnpm exec wrangler secret put <NAME> --name <worker>\n`,
  );
}

function isRequired(app, name) {
  // Mirror secret-routing's required flag without re-importing internals:
  // a name is required if it is not in the optional/overlap set.
  return secretsForApp(app, target, { requiredOnly: true }).includes(name);
}

// --- actions --------------------------------------------------------------

async function bulkSetSecrets(worker, names) {
  const payload = {};
  for (const name of names) {
    payload[name] = valueFor(name);
  }
  // Pipe JSON to `wrangler secret bulk` over stdin: no file on disk, no stdout.
  await run("pnpm", ["exec", "wrangler", "secret", "bulk", "--name", worker], JSON.stringify(payload));
}

function valueFor(name) {
  const fromEnv = resolveSecretValue(name, target);
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }
  if (!generatedValues.has(name)) {
    generatedValues.set(
      name,
      randomBytes(name.includes("PEPPER") || name.endsWith("KEY") ? 48 : 32).toString("base64url"),
    );
  }
  return generatedValues.get(name);
}

async function deployApp(app) {
  if (app === "web") {
    await run("pnpm", ["--filter", "@agent-paste/web", `deploy:${target}`]);
    return;
  }
  await run("pnpm", ["exec", "wrangler", "deploy", "--config", `apps/${app}/wrangler.jsonc`, "--env", target]);
}

async function listWorkerSecretsSafe(worker) {
  try {
    return await listWorkerSecrets(worker);
  } catch (error) {
    // A not-yet-created Worker has no secrets to list; treat as empty so the
    // first deploy provisions everything.
    const message = error instanceof Error ? error.message : String(error);
    if (/could not find|does not exist|10007|not found/i.test(message)) {
      return [];
    }
    throw error;
  }
}

// --- process plumbing -----------------------------------------------------

function run(command, args, stdin = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: [stdin === null ? "inherit" : "pipe", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
      }
    });
    if (stdin !== null) {
      child.stdin.end(stdin);
    }
  });
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
