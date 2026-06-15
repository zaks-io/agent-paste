// @ts-check
import { workerName } from "../wrangler-secrets.mjs";
import { profilePersistsKidInRecords } from "./rotation-profiles.mjs";

function planHeader(profile, target, step, operator) {
  return [`agent-paste ${target} ${profile.id} rotation (${step})`, `Operator identity (audit): ${operator}`, ""];
}

function joinPlanLines(lines) {
  return `${lines.join("\n")}\n`;
}

function secondaryBoundOnWorker(snapshot, worker) {
  if (Array.isArray(snapshot.secondaryBoundWorkers)) {
    return snapshot.secondaryBoundWorkers.includes(worker);
  }
  return Boolean(snapshot.secondaryBound);
}

export function formatDrainPlan(profile, target, _snapshot, operator) {
  const lines = [
    ...planHeader(profile, target, "drain", operator),
    profile.drainHint,
    "",
    "No wrangler writes in the drain step. After the drain window:",
    `  node scripts/rotate-versioned-secret.mjs ${profile.id} ${target} --step drop`,
    "",
    "Hosted smoke (only with explicit approval and credentials):",
    `  pnpm smoke:${target === "production" ? "production" : "preview"}`,
  ];
  return joinPlanLines(lines);
}

export function formatStagePlan(profile, target, snapshot, operator, secretValueSummary) {
  const lines = [...planHeader(profile, target, "stage", operator)];
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
  lines.push(`Secret value: ${secretValueSummary}`);
  return joinPlanLines(lines);
}

export function formatFlipPlan(profile, target, snapshot, operator) {
  const lines = [...planHeader(profile, target, "flip", operator)];
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
  return joinPlanLines(lines);
}

function formatDropKidPersistingPlan(profile, target) {
  const lines = [
    "Drop kid 1 only: delete the primary (kid 1) secret, keep _V2 bound, and leave the active kid var at v2.",
    "",
  ];
  for (const binding of profile.bindings) {
    const worker = workerName(binding.app, target);
    lines.push(`  wrangler secret delete ${profile.baseSecretName} --name ${worker}`);
    lines.push(
      `  wrangler deploy --cwd apps/${binding.app} --env ${target} --var ${profile.kidVarName}:v2 --name ${worker}`,
    );
  }
  lines.push("");
  lines.push("No --value required: wrangler deletes kid 1 material; kid 2 objects/rows keep verifying.");
  return lines;
}

function formatDropPromoteCollapsePlan(profile, target, snapshot) {
  const lines = ["Promote the v2 value into the primary secret, reset kid to v1, deploy, verify, then delete _V2.", ""];
  for (const binding of profile.bindings) {
    const worker = workerName(binding.app, target);
    lines.push(`  wrangler secret put ${profile.baseSecretName} --name ${worker}  # promoted v2 value`);
    lines.push(
      `  wrangler deploy --cwd apps/${binding.app} --env ${target} --var ${profile.kidVarName}:v1 --name ${worker}`,
    );
    if (secondaryBoundOnWorker(snapshot, worker)) {
      lines.push(`  wrangler secret delete ${profile.secondarySecretName} --name ${worker}`);
    }
  }
  lines.push("");
  lines.push(`Use --value-env <promoted-${profile.secondarySecretName}-env-var> when reusing the staged v2 material.`);
  return lines;
}

export function formatDropPlan(profile, target, snapshot, operator) {
  const body = profilePersistsKidInRecords(profile.id)
    ? formatDropKidPersistingPlan(profile, target)
    : formatDropPromoteCollapsePlan(profile, target, snapshot);
  return joinPlanLines([...planHeader(profile, target, "drop", operator), ...body]);
}

export function formatEmergencyPlan(profile, target, snapshot, operator, secretValueSummary) {
  const lines = [
    ...planHeader(profile, target, "emergency", operator),
    "Emergency cutover: overwrite primary, reset kid v1, delete _V2 when present.",
    "",
  ];
  for (const binding of profile.bindings) {
    const worker = workerName(binding.app, target);
    lines.push(`  wrangler secret put ${profile.baseSecretName} --name ${worker}`);
    lines.push(
      `  wrangler deploy --cwd apps/${binding.app} --env ${target} --var ${profile.kidVarName}:v1 --name ${worker}`,
    );
    if (secondaryBoundOnWorker(snapshot, worker)) {
      lines.push(`  wrangler secret delete ${profile.secondarySecretName} --name ${worker}`);
    }
  }
  lines.push("");
  lines.push(`Secret value: ${secretValueSummary}`);
  return joinPlanLines(lines);
}

const PLAN_FORMATTERS = {
  drain: formatDrainPlan,
  stage: formatStagePlan,
  flip: formatFlipPlan,
  drop: formatDropPlan,
  emergency: formatEmergencyPlan,
};

export function formatPlan(profile, target, step, snapshot, operator, secretValueSummary) {
  const formatter = PLAN_FORMATTERS[step];
  if (!formatter) {
    throw new Error(`Unhandled step ${step}`);
  }
  return formatter(profile, target, snapshot, operator, secretValueSummary);
}
