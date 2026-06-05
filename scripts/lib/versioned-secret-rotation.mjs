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

export function parseOptions(argv) {
  const dryRun = argv.includes("--dry-run");
  const printOnly = argv.includes("--print-only");
  const force = argv.includes("--force");
  const value = stringOption(argv, "--value");
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
  return { dryRun, printOnly, force, value, step, operator };
}

export async function collectSnapshot(profile, target) {
  const listedByWorker = new Map();
  for (const binding of profile.bindings) {
    const worker = workerName(binding.app, target);
    listedByWorker.set(worker, await listWorkerSecrets(worker));
  }
  const names = new Set();
  for (const listed of listedByWorker.values()) {
    for (const name of listed) {
      names.add(name);
    }
  }
  return {
    listedByWorker,
    snapshot: {
      primaryBound: names.has(profile.baseSecretName),
      secondaryBound: names.has(profile.secondarySecretName),
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
