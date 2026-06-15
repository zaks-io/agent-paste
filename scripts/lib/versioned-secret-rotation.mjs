// @ts-check
import { listWorkerSecrets, workerName } from "../wrangler-secrets.mjs";
import { ROTATION_AGENT_OPERATOR_ID, VERSIONED_SECRET_PROFILES } from "./rotation-profiles.mjs";

export { executeStep } from "./versioned-secret-rotation-execute.mjs";
export { formatPlan } from "./versioned-secret-rotation-format.mjs";

export function parseProfileId(value) {
  const profile = VERSIONED_SECRET_PROFILES[value];
  if (!profile) {
    throw new Error(
      `Unknown rotation profile ${JSON.stringify(value)}. Expected one of: ${Object.keys(VERSIONED_SECRET_PROFILES).join(", ")}`,
    );
  }
  return profile;
}

export function parseTarget(argv) {
  const value = argv.find((arg) => !arg.startsWith("--"));
  if (value !== "preview" && value !== "production") {
    throw new Error("Target environment must be preview or production.");
  }
  return value;
}

export function parseOptions(argv, env = process.env) {
  const dryRun = argv.includes("--dry-run");
  const printOnly = argv.includes("--print-only");
  const force = argv.includes("--force");
  const { value, valueSource, valueEnvName } = valueOption(argv, env);
  const step = stringOption(argv, "--step");
  const operator = stringOption(argv, "--operator") ?? ROTATION_AGENT_OPERATOR_ID;
  if (!step) {
    throw new Error("Missing required --step (stage|flip|drain|drop|emergency).");
  }
  if (!["stage", "flip", "drain", "drop", "emergency"].includes(step)) {
    throw new Error(`Invalid --step ${JSON.stringify(step)}.`);
  }
  if (value !== undefined && value.length === 0) {
    throw new Error("--value must be a non-empty secret.");
  }
  return { dryRun, printOnly, force, value, valueSource, valueEnvName, step, operator };
}

function valueOption(argv, env) {
  const argvValue = stringOption(argv, "--value");
  const valueEnvName = stringOption(argv, "--value-env");
  if (argvValue !== undefined && valueEnvName !== undefined) {
    throw new Error("Pass only one of --value or --value-env.");
  }
  if (argvValue !== undefined && env.npm_lifecycle_event?.startsWith("secrets:rotate:")) {
    throw new Error("Do not pass secret material through pnpm argv. Use --value-env <ENV_VAR> instead.");
  }
  if (valueEnvName === undefined) {
    return { value: argvValue, valueSource: argvValue === undefined ? undefined : "argv", valueEnvName: undefined };
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(valueEnvName)) {
    throw new Error("--value-env must name one environment variable.");
  }
  if (!Object.hasOwn(env, valueEnvName)) {
    throw new Error(`Environment variable ${valueEnvName} must contain a non-empty secret.`);
  }
  const value = env[valueEnvName];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Environment variable ${valueEnvName} must contain a non-empty secret.`);
  }
  return { value, valueSource: "env", valueEnvName };
}

export function bindingsForTarget(profile, target) {
  return profile.bindings.map((binding) => ({
    app: binding.app,
    worker: workerName(binding.app, target),
    names: [profile.baseSecretName, profile.secondarySecretName],
  }));
}

export async function collectSnapshot(profile, target, deps = {}) {
  const listSecrets = deps.listWorkerSecrets ?? listWorkerSecrets;
  const listedByWorker = new Map();
  for (const binding of profile.bindings) {
    const worker = workerName(binding.app, target);
    listedByWorker.set(worker, await listSecrets(worker));
  }
  const names = new Set();
  const primaryBoundWorkers = [];
  const secondaryBoundWorkers = [];
  for (const listed of listedByWorker.values()) {
    for (const name of listed) {
      names.add(name);
    }
  }
  for (const [worker, listed] of listedByWorker) {
    if (listed.includes(profile.baseSecretName)) {
      primaryBoundWorkers.push(worker);
    }
    if (listed.includes(profile.secondarySecretName)) {
      secondaryBoundWorkers.push(worker);
    }
  }
  return {
    listedByWorker,
    snapshot: {
      primaryBound: names.has(profile.baseSecretName),
      secondaryBound: names.has(profile.secondarySecretName),
      primaryBoundWorkers,
      secondaryBoundWorkers,
    },
  };
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
