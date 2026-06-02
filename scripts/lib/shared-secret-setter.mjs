import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { findSecretCollisions, listWorkerSecrets, putWorkerSecret, workerName } from "../wrangler-secrets.mjs";
import { VERSIONED_SECRET_PROFILES } from "./rotation-profiles.mjs";

/**
 * Worker app list for a shared secret, sourced from the rotation profile so the
 * "set" and "rotate" flows can never disagree on which Workers carry the key.
 * A rotation profile is the canonical topology; pass `apps` explicitly only for
 * shared secrets that have no versioned-rotation profile (e.g. stream-internal).
 */
export function appsForProfile(profileId) {
  const profile = VERSIONED_SECRET_PROFILES[profileId];
  if (!profile) {
    throw new Error(`Unknown rotation profile: ${profileId}`);
  }
  return profile.bindings.map((binding) => binding.app);
}

/**
 * Run a single-pass "set the same secret on every Worker that shares it" flow.
 *
 * One environment per run. A shared secret must hold one value per environment
 * and a different value across environments, so the value is generated or passed
 * once and written to each Worker in the set. This is the drift-reset path: when
 * the Workers have fallen out of sync, re-run with `--value <current-secret>` to
 * pin them all back to one value.
 *
 * @param {object} config
 * @param {string} config.secretName     Binding name, e.g. "CONTENT_SIGNING_SECRET".
 * @param {string[]} config.apps         App slugs the secret binds to, e.g. ["api","upload"].
 * @param {string} config.scriptName     Basename for usage text, e.g. "set-content-signing-secret.mjs".
 * @param {number} [config.byteLength=48] Random byte length when generating a value.
 * @param {string} config.consistencyNote Trailing line explaining why the value must match.
 * @param {string[]} argv                process.argv.slice(2)
 */
export async function runSharedSecretSetter(config, argv) {
  const { secretName, apps, scriptName, byteLength = 48, consistencyNote } = config;
  const target = parseTarget(argv, scriptName, secretName, apps);
  const options = parseOptions(argv, scriptName, secretName, apps);
  const generatedAt = new Date().toISOString();

  const bindings = apps.map((app) => ({
    app,
    worker: workerName(app, target),
    names: [secretName],
  }));

  const secretValue = await resolveSecretValue({ options, bindings, secretName, target, byteLength });

  if (!options.printOnly && !options.dryRun) {
    for (const binding of bindings) {
      await putWorkerSecret(binding.worker, secretName, secretValue);
    }
  }

  printCaptureBlock({ options, bindings, secretName, target, generatedAt, secretValue, consistencyNote });
}

function parseTarget(argv, scriptName, secretName, apps) {
  const value = argv.find((arg) => !arg.startsWith("--"));
  if (value === "live") {
    return "production";
  }
  if (value !== "preview" && value !== "production") {
    usage("Target environment must be preview or production.", { scriptName, secretName, apps });
  }
  return value;
}

function parseOptions(argv, scriptName, secretName, apps) {
  const force = argv.includes("--force");
  const printOnly = argv.includes("--print-only");
  const dryRun = argv.includes("--dry-run");
  const reset = argv.includes("--reset");
  const value = stringOption(argv, "--value");
  if (value !== undefined && value.length === 0) {
    usage("--value must be a non-empty secret.", { scriptName, secretName, apps });
  }
  if (reset && value !== undefined) {
    usage("--reset mints a fresh secret; do not also pass --value.", { scriptName, secretName, apps });
  }
  return { force, printOnly, dryRun, reset, value };
}

async function resolveSecretValue({ options, bindings, secretName, target, byteLength }) {
  if (options.dryRun) {
    return "<generated>";
  }
  if (!options.printOnly) {
    await assertSafeToWrite({ options, bindings, secretName, target });
  }
  return options.value ?? secretBytes(byteLength);
}

async function assertSafeToWrite({ options, bindings, secretName, target }) {
  const existingByWorker = new Map();
  for (const binding of bindings) {
    const listed = await listWorkerSecrets(binding.worker);
    existingByWorker.set(binding.worker, new Set(listed));
  }

  const collisions = findSecretCollisions(bindings, existingByWorker);
  if (collisions.length === 0) {
    return;
  }

  // --reset is an explicit "mint a fresh value and pin it everywhere" request,
  // so existing bindings are expected. Skip the value/force guards and go
  // straight to the typed confirmation.
  if (!options.reset) {
    if (options.value === undefined) {
      throw new Error(
        [
          `Existing ${secretName} bindings found:`,
          ...collisions.map((name) => `  - ${name}`),
          "",
          `Re-run with --reset to mint one fresh value and pin it to every Worker (drift reset),`,
          `--value <current-secret> to pin every Worker back to a known value,`,
          `or use the versioned rotation flow to roll the key.`,
          "This script will not generate a replacement for an existing active key without --reset.",
        ].join("\n"),
      );
    }

    if (!options.force) {
      throw new Error(
        [
          `Refusing to overwrite existing ${secretName} bindings:`,
          ...collisions.map((name) => `  - ${name}`),
          "",
          "Re-run with --force and type the confirmation if this is an intentional rebind/recovery.",
        ].join("\n"),
      );
    }
  }

  const phrase = `overwrite ${target} ${secretName}`;
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await readline.question(`Type "${phrase}" to overwrite existing ${secretName} secrets: `);
  readline.close();
  if (answer !== phrase) {
    throw new Error("Confirmation did not match; no secrets were written.");
  }
}

function printCaptureBlock({ options, bindings, secretName, target, generatedAt, secretValue, consistencyNote }) {
  const intro = options.dryRun
    ? options.reset
      ? "Review this plan; --reset will mint a fresh value and overwrite the existing bindings."
      : "Review this plan before writing secrets."
    : options.printOnly
      ? "Generated value only; no secrets were written."
      : "Capture this value in the password manager before closing this terminal.";
  const skipped = options.dryRun
    ? "No secrets were written because --dry-run was set.\n"
    : options.printOnly
      ? "No secrets were written because --print-only was set.\n"
      : "";
  process.stdout.write(`agent-paste ${target} ${secretName} at ${generatedAt}

${intro}
${skipped}${secretName}=${secretValue}

Workers updated with the same value:
${bindings.map((binding) => `  ${binding.worker}`).join("\n")}
${consistencyNote ? `\n${consistencyNote}\n` : ""}`);
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

function usage(message, { scriptName, secretName, apps }) {
  const workers = apps.map((app) => `agent-paste-${app}-<target>`).join(", ");
  process.stderr.write(`${message}

Usage:
  node scripts/${scriptName} preview
  node scripts/${scriptName} preview --reset
  node scripts/${scriptName} production --value <existing-secret>
  node scripts/${scriptName} production --value <existing-secret> --force
  node scripts/${scriptName} preview --dry-run

Sets the same ${secretName} on ${workers}.
Does not read or rotate any other Worker secrets. Operators run this locally; do not commit secret values.

Options:
  --reset       Mint one fresh secret and pin it to every Worker, even when the binding already exists
                (typed confirmation required). Use this to fix drift. Cannot be combined with --value.
  --value       Use an existing secret value instead of generating a new one. Required to write over an
                existing binding when not using --reset.
  --force       Allow overwriting an existing ${secretName} after typed confirmation. Requires --value.
  --dry-run     Print the rollout plan without calling wrangler.
  --print-only  Generate and print a value without calling wrangler.
`);
  process.exit(1);
}
