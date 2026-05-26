#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import {
  APP_RUNTIME_ROLE,
  connectionStringForRole,
  connectionUriHasPassword,
  DATABASE_RUNTIME_ROLE_PASSWORD_ENV,
  maskConnectionUri,
} from "../packages/db/scripts/credentials.mjs";

const options = parseArgs(process.argv.slice(2));
const projectId = requiredEnv("NEON_PROJECT_ID");
const branchId = requiredEnv("NEON_BRANCH_ID");
const apiKey = requiredEnv("NEON_API_KEY");
const roleName = process.env.NEON_ROLE_NAME ?? APP_RUNTIME_ROLE;
const databaseName = process.env.NEON_DATABASE_NAME ?? "neondb";
const bootstrapUrl = process.env.NEON_BOOTSTRAP_DATABASE_URL;
const providedPassword = process.env[DATABASE_RUNTIME_ROLE_PASSWORD_ENV];
const apiHost = (process.env.NEON_API_HOST ?? "https://console.neon.tech/api/v2").replace(/\/$/, "");

const headers = {
  Accept: "application/json",
  Authorization: `Bearer ${apiKey}`,
};

const connectionUri = await resolveRoleConnectionUri({
  apiHost,
  headers,
  projectId,
  branchId,
  roleName,
  databaseName,
  bootstrapUrl,
  providedPassword,
});

process.stdout.write(`Resolved Neon role ${roleName} on branch ${branchId}\n`);
emitOutput(options.githubOutput, connectionUri);

async function resolveRoleConnectionUri(context) {
  if (context.providedPassword && context.bootstrapUrl) {
    const built = connectionStringForRole(context.bootstrapUrl, context.roleName, context.providedPassword);
    if (!connectionUriHasPassword(built)) {
      throw new Error(`Built ${context.roleName} connection URI is missing a password.`);
    }
    return built;
  }

  const fromUri = await tryConnectionUri(context);
  if (fromUri && connectionUriHasPassword(fromUri)) {
    return fromUri;
  }

  if (context.providedPassword) {
    throw new Error(
      `Set NEON_BOOTSTRAP_DATABASE_URL when ${DATABASE_RUNTIME_ROLE_PASSWORD_ENV} is provided so the ${context.roleName} URI can be built without Neon reset_password.`,
    );
  }

  const password = await tryResetRolePassword(context);
  if (!password) {
    throw new Error(
      `Could not resolve a password-backed connection URI for Neon role ${context.roleName} on branch ${context.branchId}. ` +
        `Set ${DATABASE_RUNTIME_ROLE_PASSWORD_ENV} for SQL-provisioned roles or ensure migration 0010_db_roles.sql has run.`,
    );
  }

  const afterReset = await tryConnectionUri(context);
  if (afterReset && connectionUriHasPassword(afterReset)) {
    return afterReset;
  }

  if (context.bootstrapUrl) {
    const built = connectionStringForRole(context.bootstrapUrl, context.roleName, password);
    if (!connectionUriHasPassword(built)) {
      throw new Error(`Built ${context.roleName} connection URI is missing a password.`);
    }
    return built;
  }

  throw new Error(
    `Could not resolve a direct connection URI for Neon role ${context.roleName} on branch ${context.branchId}. ` +
      "Set NEON_BOOTSTRAP_DATABASE_URL so the resolver can build a password-backed URI after reset_password.",
  );
}

async function tryConnectionUri(context) {
  const url = new URL(`${context.apiHost}/projects/${context.projectId}/connection_uri`);
  url.searchParams.set("branch_id", context.branchId);
  url.searchParams.set("database_name", context.databaseName);
  url.searchParams.set("role_name", context.roleName);
  url.searchParams.set("pooled", "false");

  const response = await fetch(url, { headers: context.headers });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Neon connection_uri for ${context.roleName} failed: ${response.status} ${body}`);
  }
  const payload = await response.json();
  return payload.uri ?? payload.connection_uri ?? null;
}

async function tryResetRolePassword(context) {
  const url = `${context.apiHost}/projects/${context.projectId}/branches/${context.branchId}/roles/${encodeURIComponent(context.roleName)}/reset_password`;
  const response = await fetch(url, { method: "POST", headers: context.headers });
  if (response.status === 404) {
    return null;
  }
  if (response.status === 422) {
    return null;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Neon reset_password for ${context.roleName} failed: ${response.status} ${body}`);
  }
  const payload = await response.json();
  return payload.role?.password ?? null;
}

function emitOutput(name, value) {
  if (!name) {
    return;
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  process.stdout.write(`${name}=${maskConnectionUri(value)}\n`);
}

function parseArgs(argv) {
  const githubOutput = stringOption(argv, "--github-output");
  return { githubOutput };
}

function stringOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name}.`);
  }
  return value;
}
