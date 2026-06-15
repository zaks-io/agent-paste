#!/usr/bin/env node
import { PROFILE_IDS } from "./lib/rotation-profiles.mjs";
import {
  collectSnapshot,
  executeStep,
  formatPlan,
  parseOptions,
  parseProfileId,
  parseTarget,
} from "./lib/versioned-secret-rotation.mjs";

const argv = process.argv.slice(2);
const positional = argv.filter((arg) => !arg.startsWith("--"));

try {
  const profileId = positional[0];
  if (!profileId) {
    usage("Missing rotation profile.");
  }
  const profile = parseProfileId(profileId);
  const target = parseTarget(positional.slice(1));
  const options = parseOptions(argv);
  const snapshot =
    options.dryRun || options.printOnly
      ? dryRunSnapshot(options.step)
      : (await collectSnapshot(profile, target)).snapshot;
  const secretValueSummary = summarizeSecretValue(options);

  process.stdout.write(formatPlan(profile, target, options.step, snapshot, options.operator, secretValueSummary));

  if (options.printOnly) {
    process.stdout.write("\n--print-only: no wrangler commands were executed.\n");
    process.exit(0);
  }

  await executeStep(profile, target, options, snapshot);

  if (options.dryRun) {
    process.stdout.write("\n--dry-run: no wrangler commands were executed.\n");
  } else {
    process.stdout.write("\nWrangler steps completed. Record this rotation in the ops log.\n");
    process.stdout.write("Run hosted smoke only with explicit approval and credentials.\n");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  usage(message);
}

function dryRunSnapshot(step) {
  return {
    primaryBound: true,
    secondaryBound: step === "flip" || step === "drain" || step === "drop",
  };
}

function usage(message) {
  process.stderr.write(`${message}

Usage:
  node scripts/rotate-versioned-secret.mjs <profile> <preview|production> --step <stage|flip|drain|drop|emergency> [options]

Profiles:
  ${PROFILE_IDS.map((id) => `  - ${id}`).join("\n")}

Options:
  --step        Required rotation step (ADR 0045 staging-flip-drain-drop).
  --value       Existing secret material (direct node only; avoid for real secrets).
  --value-env   Environment variable containing existing secret material. Required for pnpm wrappers.
  --operator    Audit identity (default: rotation-agent@platform).
  --dry-run     Print the plan only; do not call wrangler.
  --print-only  Alias for dry-run output without listing execution.
  --force       Required typed confirmation for emergency overwrite.

Examples:
  node scripts/rotate-versioned-secret.mjs content-signing preview --step stage --dry-run
  node scripts/rotate-versioned-secret.mjs api-key-pepper preview --step flip
  node scripts/rotate-versioned-secret.mjs upload-signing production --step drain
  node scripts/rotate-versioned-secret.mjs content-signing production --step drop --value-env ROTATION_SECRET

Do not commit secret values. Operators run this locally with Wrangler auth.
`);
  process.exit(1);
}

function summarizeSecretValue(options) {
  if (options.valueSource === "env") {
    return `provided via ${options.valueEnvName} (hidden)`;
  }
  if (options.valueSource === "argv") {
    return "provided via --value (hidden)";
  }
  if (options.dryRun || options.printOnly) {
    return "generated during a real run (hidden)";
  }
  return "generated at runtime (hidden)";
}
