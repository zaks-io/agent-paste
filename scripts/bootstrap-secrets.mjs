#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";

const target = parseTarget(process.argv.slice(2));
const options = parseOptions(process.argv.slice(2));
const generatedAt = new Date().toISOString();

const adminToken = `ap_admin_${secretBytes(32)}`;
const apiKeyPepper = secretBytes();
const secrets = {
  CONTENT_SIGNING_SECRET: secretBytes(),
  UPLOAD_SIGNING_SECRET: secretBytes(),
  API_KEY_PEPPER_V1: apiKeyPepper,
  ADMIN_TOKEN: adminToken,
  ADMIN_TOKEN_HASH: hmacBase64Url(adminToken, apiKeyPepper),
  OPERATOR_EMAILS: options.operatorEmails,
};

const workerSecrets = [
  {
    app: "api",
    names: ["CONTENT_SIGNING_SECRET", "API_KEY_PEPPER_V1", "ADMIN_TOKEN_HASH", "OPERATOR_EMAILS"],
  },
  { app: "upload", names: ["CONTENT_SIGNING_SECRET", "UPLOAD_SIGNING_SECRET", "API_KEY_PEPPER_V1"] },
  { app: "content", names: ["CONTENT_SIGNING_SECRET"] },
];

if (!options.printOnly) {
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
  const operatorEmails = stringOption(argv, "--operator-emails") ?? process.env.OPERATOR_EMAILS;
  if (!operatorEmails) {
    usage("Set --operator-emails or OPERATOR_EMAILS.");
  }
  return { force, printOnly, operatorEmails };
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
  process.stdout.write(`agent-paste ${target} secrets generated at ${generatedAt}

Capture these values in the password manager before closing this terminal.
${options.printOnly ? "No secrets were written because --print-only was set.\n" : ""}
${Object.entries(secrets)
  .map(([name, value]) => `${name}=${value}`)
  .join("\n")}

Worker bindings written:
${workerSecrets.map((binding) => `  ${workerName(binding.app)}: ${binding.names.join(", ")}`).join("\n")}
`);
}

function stringOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function secretBytes(byteLength = 48) {
  return randomBytes(byteLength).toString("base64url");
}

function hmacBase64Url(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function usage(message) {
  process.stderr.write(`${message}

Usage:
  node scripts/bootstrap-secrets.mjs preview --operator-emails you@example.com
  node scripts/bootstrap-secrets.mjs production --operator-emails you@example.com

Options:
  --force       Allow overwriting existing secrets after typed confirmation.
  --print-only  Generate and print values without calling wrangler.
`);
  process.exit(1);
}
