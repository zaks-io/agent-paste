#!/usr/bin/env node
// @ts-check
// One command to deploy everything — migrations, secrets, build, and Workers. Per ADR 0078.
//
//   node scripts/deploy.mjs preview                # migrate (if needed) + deploy all
//   node scripts/deploy.mjs preview --app=apex     # deploy only apex to preview (no migration)
//   node scripts/deploy.mjs preview --no-migrate   # deploy all, skip migration
//   node scripts/deploy.mjs production
//
// What it does, machine-to-machine, with NO secret value ever printed or written
// to disk in cleartext:
//   1. Runs DB migrations first when the deploy includes a DB-backed app
//      (api/upload/jobs) and --no-migrate is not set; skipped otherwise.
//   2. For each selected Worker, lists the secret NAMES it already has (wrangler
//      secret list returns names only — values are never readable).
//   3. Generates random values IN MEMORY only for required symmetric secrets that
//      are missing, and pipes them into `wrangler secret bulk` over stdin.
//   4. Hands build + deploy to Turbo (`turbo run deploy:<target>`), which builds
//      every workspace dependency in graph order (cached) before wrangler runs.
//      Scope preview deploys to one Worker with --app; production deploys the whole fleet.
//
// Idempotent: a secret that already exists is left untouched, so re-running never
// rotates anything and is always safe. Generation is the ONLY way a value comes
// into being, and it goes straight from randomBytes() to the Worker over a pipe.
// Provider-issued secrets (WORKOS_API_KEY, CF_ACCESS_AUD, WORKOS_COOKIE_PASSWORD)
// are not random and not generated here; if a required one is missing the script
// stops and names it so you can set it from the provider console once.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureJobQueues } from "./ensure-job-queues.mjs";
import { hostedJobQueues } from "./hosted-job-queues.mjs";
import { ensureLocalEnvSecrets } from "./lib/local-env-secrets.mjs";
import {
  forbiddenSecretsForApp,
  formatForbiddenSecretDeleteInstructions,
  secretConsumingApps,
  secretsForApp,
} from "./lib/secret-routing.mjs";
import { resolveSecretValue } from "./lib/secret-values.mjs";
import { loadWranglerEnvVars } from "./lib/wrangler-env-vars.mjs";
import { listWorkerSecrets, workerName } from "./wrangler-secrets.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// Random/symmetric secrets this script may generate. Anything not listed here is
// provider-issued and must already exist on the Worker.
export const GENERATABLE = new Set([
  "CONTENT_SIGNING_SECRET",
  "UPLOAD_SIGNING_SECRET",
  "ARTIFACT_BYTES_ENCRYPTION_KEY",
  "API_KEY_PEPPER_V1",
  "ACCESS_LINK_SIGNING_KEY_V1",
  "SMOKE_HARNESS_SECRET",
  "EPHEMERAL_POW_SECRET",
  "STREAM_INTERNAL_SECRET",
]);

// Match bootstrap-secrets.mjs exactly (it is no longer the authoritative generator,
// but the two must agree per ADR 0078): the transient test/internal secrets are 32
// bytes; every cryptographic signing/pepper/encryption secret is 48 bytes (384 bits).
export const TRANSIENT_32_BYTE_SECRETS = new Set([
  "SMOKE_HARNESS_SECRET",
  "EPHEMERAL_POW_SECRET",
  "STREAM_INTERNAL_SECRET",
]);

export function generatedByteLength(name) {
  return TRANSIENT_32_BYTE_SECRETS.has(name) ? 32 : 48;
}

// Every deployable app. Build order and per-app deploy order are owned by Turbo's
// task graph (turbo run deploy:<target>, which dependsOn build); this list is only
// used for secret provisioning and --app validation.
const APPS = ["stream", "api", "upload", "content", "jobs", "mcp", "apex", "web"];

// Workspace package name per app, for `turbo run ... --filter`.
const PACKAGE_NAMES = {
  stream: "@agent-paste/stream",
  api: "@agent-paste/api",
  upload: "@agent-paste/upload",
  content: "@agent-paste/content",
  jobs: "@agent-paste/jobs",
  mcp: "@agent-paste/mcp",
  apex: "@agent-paste/apex",
  web: "@agent-paste/web",
};

// Apps whose Workers bind the database (Hyperdrive). Deploying any of these can
// depend on the schema, so migrations run first. The rest (stream, content, mcp,
// apex, web) have no DB, so a scoped deploy of only those never needs a migration.
const DB_BACKED_APPS = new Set(["api", "upload", "jobs"]);
const PRODUCTION_SCOPE_ERROR =
  "Production deploys must deploy the full fleet; --app scoping is only supported for preview deploys.";

/**
 * Resolve which apps to deploy from argv. With no --app flag, returns the full
 * fleet. With `--app=apex` (comma-separated for several), returns only those,
 * preserving APPS order. Throws on an unknown name so a typo fails loud instead
 * of silently deploying nothing.
 * @param {string[]} argv
 * @returns {string[]}
 */
export function selectApps(argv) {
  const appFlag = argv.find((a) => a.startsWith("--app="));
  if (!appFlag) {
    return APPS;
  }
  const requested = appFlag
    .slice("--app=".length)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = requested.filter((a) => !APPS.includes(a));
  if (unknown.length > 0) {
    throw new Error(`Unknown --app value(s): ${unknown.join(", ")}. Valid apps: ${APPS.join(", ")}`);
  }
  return APPS.filter((a) => requested.includes(a));
}

/**
 * Decide whether to run migrations before deploying the given apps.
 * `--no-migrate` always wins. Otherwise migrate only when the deploy includes a
 * DB-backed app, so a scoped deploy of DB-free apps (e.g. just apex) skips it.
 * @param {string[]} apps
 * @param {boolean} noMigrateFlag
 * @returns {boolean}
 */
export function shouldMigrate(apps, noMigrateFlag) {
  if (noMigrateFlag) {
    return false;
  }
  return apps.some((app) => DB_BACKED_APPS.has(app));
}

/**
 * Production deploys are intentionally full-fleet only. Preview can be scoped
 * for fast Worker-specific iteration.
 * @param {string[]} apps
 * @param {"local"|"preview"|"production"} target
 */
export function assertDeployScopeAllowed(apps, target) {
  const isFullFleet = apps.length === APPS.length && APPS.every((app, index) => apps[index] === app);
  if (target === "production" && !isFullFleet) {
    throw new Error(PRODUCTION_SCOPE_ERROR);
  }
}

/**
 * Build the `turbo run deploy:<target>` argv. A full-fleet deploy needs no
 * filters; a scoped deploy passes one --filter per selected app.
 * @param {string[]} apps
 * @param {"preview"|"production"} target
 * @returns {string[]}
 */
export function turboDeployArgs(apps, target) {
  assertDeployScopeAllowed(apps, target);
  const args = ["exec", "turbo", "run", `deploy:${target}`];
  if (apps.length < APPS.length) {
    for (const app of apps) {
      args.push(`--filter=${PACKAGE_NAMES[app]}`);
    }
  }
  return args;
}

// --- smoke ----------------------------------------------------------------

// Run the hosted smoke against the just-deployed environment. Preview gets a
// fresh harness secret threaded in memory; production uses its pre-provisioned
// smoke API key and never receives the harness secret.
async function runHostedSmoke(target, planner) {
  const smokeEnv =
    target === "preview"
      ? {
          // valueFor returns exactly what was bound to preview Workers, so the
          // smoke authenticates with the same in-memory value.
          AGENT_PASTE_SMOKE_HARNESS_SECRET: planner.valueFor("SMOKE_HARNESS_SECRET"),
        }
      : {};
  process.stdout.write(`\nRunning ${target} hosted smoke...\n`);
  await run("pnpm", ["exec", "node", "scripts/smoke-hosted.mjs", target], null, smokeEnv);
  process.stdout.write(`${target} hosted smoke passed.\n`);
}

// --- planning (exported for behavior tests) -------------------------------

export function formatMissingProviderSecretsMessage(missingProvider) {
  return (
    `These required provider-issued secrets are missing and cannot be generated:\n` +
    missingProvider.map((entry) => `  - ${entry}`).join("\n") +
    `\n\nSet each once with (value piped, never typed inline):\n` +
    `  printf %s '<value-from-provider-console>' | pnpm exec wrangler secret put <NAME> --name <worker>\n`
  );
}

export function formatForbiddenProductionSecretsMessage(forbiddenSecrets) {
  return (
    `These production Worker secrets are forbidden and must be removed before deploy:\n` +
    formatForbiddenSecretDeleteInstructions(forbiddenSecrets) +
    `\n\nProduction smoke must use AGENT_PASTE_PRODUCTION_SMOKE_API_KEY, not SMOKE_HARNESS_SECRET.`
  );
}

/**
 * Injectable secret planner for deploy-time provisioning. Used by deploy.mjs and
 * behavior tests (mock listSecretsForWorker / run at the boundary).
 * @param {object} options
 * @param {"preview"|"production"} options.target
 * @param {boolean} [options.runSmoke]
 * @param {Map<string, string>} [options.generatedValues]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {(worker: string) => Promise<string[]>} [options.listSecretsForWorker]
 * @param {(size: number) => Buffer} [options.randomBytesFn]
 */
export function createSecretPlanner({
  target,
  runSmoke = false,
  generatedValues = new Map(),
  env = process.env,
  listSecretsForWorker,
  randomBytesFn = randomBytes,
}) {
  // When running preview smoke, pre-seed a fresh SMOKE_HARNESS_SECRET so the
  // deploy binds it to its consumers AND the smoke run below authenticates with
  // the same in-memory value. Production smoke uses a pre-provisioned API key.
  if (runSmoke && target === "preview") {
    generatedValues.set("SMOKE_HARNESS_SECRET", randomBytesFn(32).toString("base64url"));
  }

  function resolveValue(name) {
    return resolveSecretValue(name, target, env);
  }

  function isRequired(app, name) {
    return secretsForApp(app, target, { requiredOnly: true }).includes(name);
  }

  function valueFor(name) {
    if (generatedValues.has(name)) {
      return generatedValues.get(name);
    }
    // resolveSecretValue already treats empty/whitespace as undefined, so a defined
    // value here is a real one; no separate empty-string check needed.
    const fromEnv = resolveValue(name);
    if (fromEnv !== undefined) {
      return fromEnv;
    }
    generatedValues.set(name, randomBytesFn(generatedByteLength(name)).toString("base64url"));
    return generatedValues.get(name);
  }

  function classifySecret(app, worker, name, existing) {
    const forceRotate = runSmoke && name === "SMOKE_HARNESS_SECRET";
    if (existing.has(name) && !forceRotate) {
      return null;
    }
    if (resolveValue(name) !== undefined || GENERATABLE.has(name)) {
      return { kind: "set", name };
    }
    if (isRequired(app, name)) {
      return { kind: "missing", name: `${worker}:${name}` };
    }
    return null;
  }

  async function planSecretsForApp(app) {
    const worker = workerName(app, target);
    const existing = new Set(await listSecretsForWorker(worker));
    const toSet = [];
    const missingProvider = [];
    const forbiddenProductionSecrets = [];
    for (const name of forbiddenSecretsForApp(app, target)) {
      if (existing.has(name)) {
        forbiddenProductionSecrets.push({ worker, name });
      }
    }
    for (const name of secretsForApp(app, target)) {
      const decision = classifySecret(app, worker, name, existing);
      if (decision?.kind === "set") {
        toSet.push(decision.name);
      } else if (decision?.kind === "missing") {
        missingProvider.push(decision.name);
      }
    }
    return { toSet, missingProvider, forbiddenProductionSecrets };
  }

  /**
   * @param {string[]} [scopeApps] Restrict provisioning to this app set (a scoped
   *   --app deploy). Defaults to every secret-consuming app (full deploy).
   */
  async function buildProvisionPlan(scopeApps) {
    /** @type {Map<string, string[]> & { missingProvider?: string[], forbiddenProductionSecrets?: Array<{ worker: string, name: string }> }} */
    const plan = new Map();
    const missingProvider = [];
    const forbiddenProductionSecrets = [];
    const scope = scopeApps ? new Set(scopeApps) : null;
    for (const app of secretConsumingApps()) {
      if (scope && !scope.has(app)) {
        continue;
      }
      const {
        toSet,
        missingProvider: appMissing,
        forbiddenProductionSecrets: appForbiddenProductionSecrets,
      } = await planSecretsForApp(app);
      missingProvider.push(...appMissing);
      forbiddenProductionSecrets.push(...appForbiddenProductionSecrets);
      if (toSet.length > 0) {
        plan.set(app, toSet);
      }
    }
    plan.missingProvider = missingProvider;
    plan.forbiddenProductionSecrets = forbiddenProductionSecrets;
    return plan;
  }

  function reportForbiddenProductionSecrets(plan, failFn = fail) {
    if (!plan.forbiddenProductionSecrets || plan.forbiddenProductionSecrets.length === 0) {
      return;
    }
    failFn(formatForbiddenProductionSecretsMessage(plan.forbiddenProductionSecrets));
  }

  function reportMissingProviderSecrets(plan, failFn = fail) {
    if (!plan.missingProvider || plan.missingProvider.length === 0) {
      return;
    }
    failFn(formatMissingProviderSecretsMessage(plan.missingProvider));
  }

  async function bulkSetSecrets(worker, names, runFn) {
    const payload = {};
    for (const name of names) {
      payload[name] = valueFor(name);
    }
    await runFn("pnpm", ["exec", "wrangler", "secret", "bulk", "--name", worker], JSON.stringify(payload));
  }

  return {
    buildProvisionPlan,
    reportForbiddenProductionSecrets,
    reportMissingProviderSecrets,
    bulkSetSecrets,
    valueFor,
    generatedValues,
  };
}

export async function runDeployPlan({
  target,
  planner,
  provisionPlan,
  apps = APPS,
  runFn,
  deployFn,
  failFn = fail,
  write = (message) => process.stdout.write(message),
}) {
  planner.reportForbiddenProductionSecrets(provisionPlan, failFn);
  planner.reportMissingProviderSecrets(provisionPlan, failFn);

  // Bind secrets to every selected Worker BEFORE deploying any of them: Turbo
  // deploys the set together (in build-graph order), so all secrets must already
  // be in place when the first Worker goes live.
  for (const app of apps) {
    const worker = workerName(app, target);
    const toSet = provisionPlan.get(app) ?? [];
    if (toSet.length > 0) {
      write(`Provisioning ${worker} secrets: ${toSet.join(", ")}\n`);
      await planner.bulkSetSecrets(worker, toSet, runFn);
    }
  }

  // Build + deploy is Turbo's job: `turbo run deploy:<target>` dependsOn build, so
  // every workspace dependency is built (cached) in graph order before wrangler
  // runs, and apex/web bake the right per-env URLs from AGENT_PASTE_ENV/CLOUDFLARE_ENV
  // (set on the env we hand Turbo). A scoped deploy passes one --filter per app.
  write(`Deploying ${apps.join(", ")} via Turbo...\n`);
  await deployFn(apps, target);
  write("\n");
}

// Default deploy step: hand build + deploy to Turbo with the per-env build switches
// set so prerendered/bundled output bakes the correct environment. Overridable in
// tests via runDeployPlan({ deployFn }).
async function turboDeploy(apps, target) {
  await run("pnpm", turboDeployArgs(apps, target), null, buildSwitchesFor(target));
}

// Per-env build switches handed to Turbo's deploy run. AGENT_PASTE_ENV/CLOUDFLARE_ENV
// pick the environment (cross-app URLs, emitted web config); BILLING_ENABLED and
// CF_WEB_ANALYTICS_TOKEN are resolved from apex's wrangler.jsonc `vars` (their single
// source) so the prerendered HTML bakes the right billing/analytics state per env.
// Turbo passes these through because they are declared on the build/deploy task env.
function buildSwitchesFor(target) {
  const env = { AGENT_PASTE_ENV: target, CLOUDFLARE_ENV: target };
  loadWranglerEnvVars("apps/apex/wrangler.jsonc", {
    cwd: root,
    env,
    envName: target,
    keys: ["BILLING_ENABLED", "CF_WEB_ANALYTICS_TOKEN"],
  });
  return env;
}

async function listWorkerSecretsSafe(worker) {
  try {
    return await listWorkerSecrets(worker, runWranglerCapture);
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

function runWranglerCapture(command, args, stdin = null, runOptions = {}) {
  if (command !== "wrangler") {
    return runCapture(command, args, stdin, runOptions);
  }
  return runCapture("pnpm", ["exec", "wrangler", ...args], stdin, runOptions);
}

function runCapture(command, args, stdin = null, runOptions = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
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
      if (result.code === 0 || runOptions.allowFailure) {
        resolve(result);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${result.code}\n${stderr || stdout}`));
    });
    if (stdin !== null) {
      child.stdin.end(`${stdin}\n`);
    } else {
      child.stdin.end();
    }
  });
}

function run(command, args, stdin = null, envOverride = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: envOverride ? { ...process.env, ...envOverride } : process.env,
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

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const rawTarget = argv.find((a) => !a.startsWith("--")) ?? "preview";
  const target = rawTarget === "live" ? "production" : rawTarget;
  if (target !== "local" && target !== "preview" && target !== "production") {
    fail("Usage: node scripts/deploy.mjs <local|preview|production> [--app=<name>] [--no-migrate] [--smoke]");
  }

  // --app=<name>: for preview deploys, deploy only the named app(s),
  // comma-separated. Scopes BOTH secret provisioning and the Turbo build+deploy
  // to one Worker (e.g. apex, the marketing page). A typo fails loud, not silently.
  let apps;
  try {
    apps = selectApps(argv);
    assertDeployScopeAllowed(apps, target);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  // --smoke: after deploying preview, rotate SMOKE_HARNESS_SECRET to a fresh
  // value, bind it to its consumer Workers, and run the hosted smoke with that
  // exact value held in memory. Production smoke uses AGENT_PASTE_PRODUCTION_SMOKE_API_KEY.
  // Not valid for local, which has no hosted smoke.
  const runSmoke = argv.includes("--smoke");
  if (runSmoke && target === "local") {
    fail("--smoke applies to preview/production, not local.");
  }

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
    return;
  }

  // Shared secrets must hold the SAME value across every Worker that consumes them
  // (e.g. CONTENT_SIGNING_SECRET is minted on api/upload and verified on content).
  // Generate one value per name, reuse it everywhere.
  const generatedValues = new Map();

  const planner = createSecretPlanner({
    target,
    runSmoke,
    generatedValues,
    listSecretsForWorker: (worker) => listWorkerSecretsSafe(worker),
  });

  process.stdout.write(`Deploying agent-paste to ${target}: ${apps.join(", ")}.\n\n`);

  // Migrations run before any Worker is deployed, and only when the deploy touches a
  // DB-backed app (skipped for e.g. an apex-only deploy, or with --no-migrate). Owning
  // this here — not in a package.json `&&` chain — is what lets a scoped deploy of a
  // DB-free Worker skip the migration cleanly.
  if (shouldMigrate(apps, argv.includes("--no-migrate"))) {
    process.stdout.write(`Running ${target} migrations...\n`);
    await run("pnpm", ["exec", "node", "scripts/migrate.mjs", target]);
    process.stdout.write("\n");
  }

  process.stdout.write(`Ensuring hosted ${target} Cloudflare Queues exist...\n`);
  await ensureJobQueues(hostedJobQueues(target).creationOrder);

  const provisionPlan = await planner.buildProvisionPlan(apps);
  await runDeployPlan({ target, planner, provisionPlan, apps, runFn: run, deployFn: turboDeploy });

  process.stdout.write(`${target} deploy complete. No secret values were displayed.\n`);

  if (runSmoke) {
    await runHostedSmoke(target, planner);
  }
}

if (isMainModule) {
  await main();
}
