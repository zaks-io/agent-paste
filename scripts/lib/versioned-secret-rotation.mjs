import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { findSecretCollisions, listWorkerSecrets, putWorkerSecret, run, workerName } from "../wrangler-secrets.mjs";
import { ROTATION_AGENT_OPERATOR_ID, VERSIONED_SECRET_PROFILES } from "./rotation-profiles.mjs";

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
  if (value === "live") {
    return "production";
  }
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

export function bindingsForTarget(profile, target) {
  return profile.bindings.map((binding) => ({
    app: binding.app,
    worker: workerName(binding.app, target),
    names: [profile.baseSecretName, profile.secondarySecretName],
  }));
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

export function formatPlan(profile, target, step, snapshot, operator, valuePlaceholder) {
  const lines = [
    `agent-paste ${target} ${profile.id} rotation (${step})`,
    `Operator identity (audit): ${operator}`,
    "",
  ];

  if (step === "drain") {
    lines.push(profile.drainHint);
    lines.push("");
    lines.push("No wrangler writes in the drain step. After the drain window:");
    lines.push(`  node scripts/rotate-versioned-secret.mjs ${profile.id} ${target} --step drop`);
    lines.push("");
    lines.push("Hosted smoke (only with explicit approval and credentials):");
    lines.push(`  pnpm smoke:${target === "production" ? "production" : "preview"}`);
    return `${lines.join("\n")}\n`;
  }

  if (step === "stage") {
    if (!snapshot.primaryBound) {
      lines.push("Primary secret is not bound. Use bootstrap for first deploy, not overlap rotation.");
    }
    if (snapshot.secondaryBound) {
      lines.push(`${profile.secondarySecretName} is already bound.`);
    }
    lines.push(`Keep ${profile.kidVarName}=v1 until flip.`);
    lines.push("");
    for (const binding of profile.bindings) {
      lines.push(`  wrangler secret put ${profile.secondarySecretName} --name ${workerName(binding.app, target)}`);
    }
    lines.push("");
    lines.push(`Planned value placeholder: ${valuePlaceholder}`);
    return `${lines.join("\n")}\n`;
  }

  if (step === "flip") {
    if (!snapshot.secondaryBound) {
      lines.push(`Bind ${profile.secondarySecretName} on every Worker before flip.`);
      lines.push("");
    }
    for (const binding of profile.bindings) {
      const worker = workerName(binding.app, target);
      lines.push(
        `  wrangler deploy --cwd apps/${binding.app} --env ${target} --var ${profile.kidVarName}:v2 --name ${worker}`,
      );
    }
    lines.push("");
    lines.push("Next: drain, then drop.");
    lines.push(profile.drainHint);
    return `${lines.join("\n")}\n`;
  }

  if (step === "drop") {
    lines.push("Promote the v2 value into the primary secret, reset kid to v1, deploy, verify, then delete _V2.");
    lines.push("");
    for (const binding of profile.bindings) {
      const worker = workerName(binding.app, target);
      lines.push(`  wrangler secret put ${profile.baseSecretName} --name ${worker}  # promoted v2 value`);
      lines.push(
        `  wrangler deploy --cwd apps/${binding.app} --env ${target} --var ${profile.kidVarName}:v1 --name ${worker}`,
      );
      lines.push(`  wrangler secret delete ${profile.secondarySecretName} --name ${worker}`);
    }
    lines.push("");
    lines.push(`Use --value <promoted-${profile.secondarySecretName}> when reusing the staged v2 material.`);
    return `${lines.join("\n")}\n`;
  }

  if (step === "emergency") {
    lines.push("Emergency cutover: overwrite primary, reset kid v1, delete _V2 when present.");
    lines.push("");
    for (const binding of profile.bindings) {
      const worker = workerName(binding.app, target);
      lines.push(`  wrangler secret put ${profile.baseSecretName} --name ${worker}`);
      lines.push(
        `  wrangler deploy --cwd apps/${binding.app} --env ${target} --var ${profile.kidVarName}:v1 --name ${worker}`,
      );
      if (snapshot.secondaryBound) {
        lines.push(`  wrangler secret delete ${profile.secondarySecretName} --name ${worker}`);
      }
    }
    lines.push("");
    lines.push(`Planned value placeholder: ${valuePlaceholder}`);
    return `${lines.join("\n")}\n`;
  }

  throw new Error(`Unhandled step ${step}`);
}

export async function executeStep(profile, target, options, snapshot) {
  const generated = options.dryRun ? "<generated>" : secretBytes(48);
  const secondaryValue = options.value ?? generated;

  if (options.step === "drain") {
    return;
  }

  if (options.step === "flip") {
    if (!options.dryRun && !options.printOnly) {
      for (const binding of profile.bindings) {
        const worker = workerName(binding.app, target);
        await run("wrangler", [
          "deploy",
          "--cwd",
          `apps/${binding.app}`,
          "--env",
          target,
          "--var",
          `${profile.kidVarName}:v2`,
          "--name",
          worker,
        ]);
      }
    }
    return;
  }

  const bindings = bindingsForTarget(profile, target).map((binding) => ({
    worker: binding.worker,
    names:
      options.step === "stage"
        ? [profile.secondarySecretName]
        : options.step === "drop"
          ? [profile.baseSecretName]
          : [profile.baseSecretName],
  }));

  if (!options.dryRun && !options.printOnly && options.step !== "flip") {
    await assertSafeToWrite(profile, target, options, bindings, snapshot);
  }

  if (options.step === "stage") {
    if (!options.dryRun && !options.printOnly) {
      for (const binding of bindings) {
        await putWorkerSecret(binding.worker, profile.secondarySecretName, secondaryValue);
      }
    }
    return;
  }

  if (options.step === "drop" || options.step === "emergency") {
    const primaryValue = options.value ?? secondaryValue;
    if (!options.dryRun && !options.printOnly) {
      for (const binding of profile.bindings) {
        const worker = workerName(binding.app, target);
        await putWorkerSecret(worker, profile.baseSecretName, primaryValue);
        await run("wrangler", [
          "deploy",
          "--cwd",
          `apps/${binding.app}`,
          "--env",
          target,
          "--var",
          `${profile.kidVarName}:v1`,
          "--name",
          worker,
        ]);
        if (snapshot.secondaryBound || options.step === "emergency") {
          await run("wrangler", ["secret", "delete", profile.secondarySecretName, "--name", worker]);
        }
      }
    }
  }
}

async function assertSafeToWrite(profile, target, options, bindings, snapshot) {
  const existingByWorker = new Map();
  for (const binding of bindings) {
    existingByWorker.set(binding.worker, new Set(await listWorkerSecrets(binding.worker)));
  }

  if (options.step === "stage" && snapshot.secondaryBound && options.value === undefined) {
    throw new Error(
      [
        `${profile.secondarySecretName} is already bound.`,
        "Re-run with --value <current-v2-secret> to continue, or delete _V2 manually before regenerating.",
      ].join("\n"),
    );
  }

  if (options.step === "drop" && options.value === undefined) {
    throw new Error(
      [
        "Drop requires --value <promoted-secret> (normally the staged v2 material).",
        "Wrangler cannot read existing secret values back.",
      ].join("\n"),
    );
  }

  const collisions = findSecretCollisions(options.step === "stage" ? bindings : [], existingByWorker);
  if (options.step === "stage" && collisions.length > 0 && options.value === undefined) {
    throw new Error(
      [
        `Refusing to auto-generate over existing ${profile.secondarySecretName}:`,
        ...collisions.map((name) => `  - ${name}`),
        "",
        "Pass --value when reusing the staged secondary secret.",
      ].join("\n"),
    );
  }

  if (options.step === "emergency" && snapshot.primaryBound && !options.force && options.value === undefined) {
    throw new Error(
      [
        `Refusing emergency overwrite of ${profile.baseSecretName} without --value and --force.`,
        "Type confirmation is required on the next run with --force.",
      ].join("\n"),
    );
  }

  if (options.step === "emergency" && options.force && snapshot.primaryBound) {
    const phrase = `emergency ${target} ${profile.id}`;
    const readline = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await readline.question(`Type "${phrase}" to continue: `);
    readline.close();
    if (answer !== phrase) {
      throw new Error("Confirmation did not match; no secrets were written.");
    }
  }
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

function secretBytes(byteLength = 48) {
  return randomBytes(byteLength).toString("base64url");
}
