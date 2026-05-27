#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";

const target = parseTarget(process.argv.slice(2));
const options = parseOptions(process.argv.slice(2));
const generatedAt = new Date().toISOString();
const webSecretNames = ["WORKOS_API_KEY", "WORKOS_CLIENT_ID", "WORKOS_COOKIE_PASSWORD"];

const secrets = options.dryRun ? plannedSecrets() : generatedSecrets();

const workerSecrets = [
  {
    app: "api",
    names: [
      "CONTENT_SIGNING_SECRET",
      "API_KEY_PEPPER_V1",
      "SMOKE_HARNESS_SECRET",
      "STREAM_INTERNAL_SECRET",
      ...(options.includeWeb ? ["WORKOS_API_KEY", "WORKOS_CLIENT_ID"] : []),
    ],
  },
  { app: "upload", names: ["CONTENT_SIGNING_SECRET", "UPLOAD_SIGNING_SECRET", "API_KEY_PEPPER_V1"] },
  { app: "content", names: ["CONTENT_SIGNING_SECRET"] },
  { app: "stream", names: ["STREAM_INTERNAL_SECRET"] },
  ...(options.includeWeb
    ? [
        {
          app: "web",
          names: ["WORKOS_API_KEY", "WORKOS_CLIENT_ID", "WORKOS_COOKIE_PASSWORD"],
        },
      ]
    : []),
];

if (!options.printOnly && !options.dryRun) {
  await assertSafeToWrite();
  for (const binding of workerSecrets) {
    for (const name of binding.names) {
      await putSecret(binding.app, name, secrets[name]);
    }
  }
}

printCaptureBlock();

function parseTarget(argv) {
  const value = argv.find((arg) => !arg.startsWith("--"));
  if (value === "live") {
    return "production";
  }
  if (value !== "preview" && value !== "production") {
    usage("Target environment must be preview or production.");
  }
  return value;
}

function parseOptions(argv) {
  const force = argv.includes("--force");
  const printOnly = argv.includes("--print-only");
  const dryRun = argv.includes("--dry-run");
  const skipWeb = argv.includes("--skip-web");
  const withWeb = argv.includes("--with-web");
  const workosApiKey = stringOption(argv, "--workos-api-key") ?? process.env.WORKOS_API_KEY;
  const workosClientId = stringOption(argv, "--workos-client-id") ?? process.env.WORKOS_CLIENT_ID;
  const workosCookiePassword = stringOption(argv, "--workos-cookie-password") ?? process.env.WORKOS_COOKIE_PASSWORD;
  const providedWebValueCount = [workosApiKey, workosClientId, workosCookiePassword].filter(Boolean).length;
  if (skipWeb && (withWeb || providedWebValueCount > 0)) {
    usage("--skip-web cannot be combined with --with-web or WorkOS secret inputs.");
  }
  const includeWeb = !skipWeb && (withWeb || providedWebValueCount > 0);
  if (includeWeb) {
    const missing = [
      ["--workos-api-key or WORKOS_API_KEY", workosApiKey],
      ["--workos-client-id or WORKOS_CLIENT_ID", workosClientId],
      ["--workos-cookie-password or WORKOS_COOKIE_PASSWORD", workosCookiePassword],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      usage(`Web secret setup requires all WorkOS inputs. Missing: ${missing.join(", ")}.`);
    }
    if (workosCookiePassword.length < 32) {
      usage("WORKOS_COOKIE_PASSWORD must be at least 32 characters.");
    }
  }
  return {
    force,
    printOnly,
    dryRun,
    includeWeb,
    workosApiKey,
    workosClientId,
    workosCookiePassword,
  };
}

async function assertSafeToWrite() {
  const existing = new Map();
  for (const binding of workerSecrets) {
    const listed = await listSecrets(binding.app);
    for (const secret of listed) {
      existing.set(`${binding.app}:${secret}`, true);
    }
  }

  const collisions = workerSecrets.flatMap((binding) =>
    binding.names
      .filter((name) => existing.has(`${binding.app}:${name}`))
      .map((name) => `${workerName(binding.app)}:${name}`),
  );

  if (collisions.length === 0) {
    return;
  }

  if (!options.force) {
    throw new Error(
      [
        "Refusing to overwrite existing Worker secrets:",
        ...collisions.map((name) => `  - ${name}`),
        "",
        "Re-run with --force and type the confirmation if this is an intentional re-bootstrap.",
      ].join("\n"),
    );
  }

  const phrase = `overwrite ${target} secrets`;
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await readline.question(`Type "${phrase}" to overwrite existing ${target} secrets: `);
  readline.close();
  if (answer !== phrase) {
    throw new Error("Confirmation did not match; no secrets were written.");
  }
}

async function listSecrets(app) {
  const result = await run("wrangler", ["secret", "list", "--name", workerName(app), "--json"], null, {
    allowFailure: true,
  });
  if (result.code !== 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed.flatMap((item) => (typeof item.name === "string" ? [item.name] : [])) : [];
  } catch {
    return [];
  }
}

async function putSecret(app, name, value) {
  await run("wrangler", ["secret", "put", name, "--name", workerName(app)], value);
}

function workerName(app) {
  return `agent-paste-${app}-${target}`;
}

function generatedSecrets() {
  const apiKeyPepper = secretBytes();
  return {
    CONTENT_SIGNING_SECRET: secretBytes(),
    UPLOAD_SIGNING_SECRET: secretBytes(),
    API_KEY_PEPPER_V1: apiKeyPepper,
    SMOKE_HARNESS_SECRET: secretBytes(32),
    STREAM_INTERNAL_SECRET: secretBytes(32),
    ...(options.includeWeb
      ? {
          WORKOS_API_KEY: options.workosApiKey,
          WORKOS_CLIENT_ID: options.workosClientId,
          WORKOS_COOKIE_PASSWORD: options.workosCookiePassword,
        }
      : {}),
  };
}

function plannedSecrets() {
  return {
    CONTENT_SIGNING_SECRET: "<generated>",
    UPLOAD_SIGNING_SECRET: "<generated>",
    API_KEY_PEPPER_V1: "<generated>",
    SMOKE_HARNESS_SECRET: "<generated; non-production smoke harness only>",
    STREAM_INTERNAL_SECRET: "<generated; shared by api and stream Workers>",
    ...(options.includeWeb
      ? {
          WORKOS_API_KEY: "<provided>",
          WORKOS_CLIENT_ID: "<provided>",
          WORKOS_COOKIE_PASSWORD: "<provided>",
        }
      : {}),
  };
}

function run(command, args, stdin, runOptions = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
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
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${result.code}\n${stderr || stdout}`));
      }
    });
    if (stdin !== null) {
      child.stdin.end(`${stdin}\n`);
    } else {
      child.stdin.end();
    }
  });
}

function printCaptureBlock() {
  const bindingHeader = options.dryRun || options.printOnly ? "Worker bindings planned:" : "Worker bindings written:";
  const intro = options.dryRun
    ? "Review this redacted binding plan before running the real bootstrap."
    : "Capture these values in the password manager before closing this terminal.";
  process.stdout.write(`agent-paste ${target} ${options.dryRun ? "secret binding plan" : "secrets generated"} at ${generatedAt}

${intro}
${options.dryRun ? "No secrets were generated or written because --dry-run was set.\n" : ""}
${options.printOnly ? "No secrets were written because --print-only was set.\n" : ""}
${Object.entries(secrets)
  .map(([name, value]) => `${name}=${displaySecretValue(name, value)}`)
  .join("\n")}

${bindingHeader}
${workerSecrets.map((binding) => `  ${workerName(binding.app)}: ${binding.names.join(", ")}`).join("\n")}
${options.includeWeb ? "\nWORKOS_CLIENT_ID is written as a Worker secret by this script. The wrangler.jsonc vars remain non-secret deployment metadata/placeholders and are not modified here.\n" : ""}
`);
}

function displaySecretValue(name, value) {
  if (options.dryRun) {
    return value;
  }
  if (webSecretNames.includes(name)) {
    return "<provided; redacted>";
  }
  return value;
}

function stringOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function secretBytes(byteLength = 48) {
  return randomBytes(byteLength).toString("base64url");
}

function usage(message) {
  process.stderr.write(`${message}

Usage:
  node scripts/bootstrap-secrets.mjs preview
  node scripts/bootstrap-secrets.mjs preview \\
    --with-web \\
    --workos-api-key sk_... \\
    --workos-client-id client_... \\
    --workos-cookie-password ...
  node scripts/bootstrap-secrets.mjs production \\
    --with-web \\
    --workos-api-key sk_... \\
    --workos-client-id client_... \\
    --workos-cookie-password ...

Options:
  --force              Allow overwriting existing secrets after typed confirmation.
  --dry-run            Print a redacted binding plan without generating values or calling wrangler.
  --print-only         Generate and print values without calling wrangler.
  --with-web           Include WorkOS AuthKit secrets for api and web Workers.
  --skip-web           Force CLI-first bootstrap only; cannot be combined with WorkOS inputs.
  --workos-api-key     WorkOS API key (sk_...). Env fallback: WORKOS_API_KEY.
  --workos-client-id   WorkOS client id (client_...). Env fallback: WORKOS_CLIENT_ID.
  --workos-cookie-password
                       32+ char AuthKit cookie password. Env fallback: WORKOS_COOKIE_PASSWORD.
`);
  process.exit(1);
}
