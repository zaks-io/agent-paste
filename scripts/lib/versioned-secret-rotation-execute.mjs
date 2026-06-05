import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { findSecretCollisions, listWorkerSecrets, putWorkerSecret, run, workerName } from "../wrangler-secrets.mjs";
import { appendRotationAuditRecord } from "./rotation-audit.mjs";
import { profilePersistsKidInRecords } from "./rotation-profiles.mjs";

function bindingsForTarget(profile, target) {
  return profile.bindings.map((binding) => ({
    app: binding.app,
    worker: workerName(binding.app, target),
    names: [profile.baseSecretName, profile.secondarySecretName],
  }));
}

function secretBytes(byteLength = 48) {
  return randomBytes(byteLength).toString("base64url");
}

function auditRecord(options, profile, target, step, action) {
  appendRotationAuditRecord({
    at: new Date().toISOString(),
    operator: options.operator,
    profile: profile.id,
    target,
    step,
    ...(action ? { action } : {}),
  });
}

async function deployKidVar(profile, target, kidValue) {
  for (const binding of profile.bindings) {
    const worker = workerName(binding.app, target);
    await run("wrangler", [
      "deploy",
      "--cwd",
      `apps/${binding.app}`,
      "--env",
      target,
      "--var",
      `${profile.kidVarName}:${kidValue}`,
      "--name",
      worker,
    ]);
  }
}

async function executeFlipStep(profile, target, options) {
  if (options.dryRun || options.printOnly) {
    return;
  }
  await deployKidVar(profile, target, "v2");
  auditRecord(options, profile, target, "flip");
}

async function executeStageStep(profile, target, options, bindings, secondaryValue) {
  if (options.dryRun || options.printOnly) {
    return;
  }
  for (const binding of bindings) {
    await putWorkerSecret(binding.worker, profile.secondarySecretName, secondaryValue);
  }
  auditRecord(options, profile, target, "stage");
}

async function executeDropKidPersistingStep(profile, target, options) {
  if (options.dryRun || options.printOnly) {
    return;
  }
  for (const binding of profile.bindings) {
    const worker = workerName(binding.app, target);
    await run("wrangler", ["secret", "delete", profile.baseSecretName, "--name", worker]);
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
  auditRecord(options, profile, target, "drop", "drop_kid_1");
}

async function executePromoteOrEmergencyStep(profile, target, options, snapshot, step, primaryValue) {
  if (options.dryRun || options.printOnly) {
    return;
  }
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
    if (snapshot.secondaryBound || step === "emergency") {
      await run("wrangler", ["secret", "delete", profile.secondarySecretName, "--name", worker]);
    }
  }
  auditRecord(options, profile, target, step, step === "emergency" ? "emergency_cutover" : "promote_collapse");
}

function secretNamesForStep(profile, step) {
  if (step === "stage") {
    return [profile.secondarySecretName];
  }
  if (step === "drop" && profilePersistsKidInRecords(profile.id)) {
    return [];
  }
  return [profile.baseSecretName];
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

  if (options.step === "drop" && !profilePersistsKidInRecords(profile.id) && options.value === undefined) {
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

export async function executeStep(profile, target, options, snapshot) {
  const generated = options.dryRun ? "<generated>" : secretBytes(48);
  const secondaryValue = options.value ?? generated;

  if (options.step === "drain") {
    return;
  }

  if (options.step === "flip") {
    await executeFlipStep(profile, target, options);
    return;
  }

  const bindings = bindingsForTarget(profile, target).map((binding) => ({
    worker: binding.worker,
    names: secretNamesForStep(profile, options.step),
  }));

  if (!options.dryRun && !options.printOnly) {
    await assertSafeToWrite(profile, target, options, bindings, snapshot);
  }

  if (options.step === "stage") {
    await executeStageStep(profile, target, options, bindings, secondaryValue);
    return;
  }

  if (options.step === "drop" && profilePersistsKidInRecords(profile.id)) {
    await executeDropKidPersistingStep(profile, target, options);
    return;
  }

  if (options.step === "drop" || options.step === "emergency") {
    const primaryValue = options.value ?? secondaryValue;
    await executePromoteOrEmergencyStep(profile, target, options, snapshot, options.step, primaryValue);
  }
}
