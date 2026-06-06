#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { APP_RUNTIME_ROLE, RUNTIME_ROLE_GUC, RUNTIME_ROLE_PASSWORD_GUC } from "./credentials.mjs";

const migrationsDir = resolve("migrations");

if (isMain(import.meta.url)) {
  runRlsCoverageCheck().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export async function runRlsCoverageCheck({ log = (message) => process.stdout.write(message) } = {}) {
  const client = new PGlite();
  let result;
  let originalError;
  try {
    await applyMigrations(client);
    result = await assertRlsCoverage(client);
    log(`RLS coverage ok: ${result.tables.length} workspace_id table(s) have FORCE RLS and tenant policies.\n`);
  } catch (error) {
    originalError = error;
  }

  const closeError = await closeClient(client);
  if (originalError != null) {
    throw originalError;
  }
  if (closeError != null) {
    throw closeError;
  }
  return result;
}

async function closeClient(client) {
  try {
    await client.close();
    return null;
  } catch (error) {
    return error;
  }
}

export async function applyMigrations(client) {
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    if (file === "0010_db_roles.sql") {
      await applyDbRolesMigration(client);
      continue;
    }
    await client.exec(await readFile(resolve(migrationsDir, file), "utf8"));
  }
}

async function applyDbRolesMigration(client) {
  await client.exec(`select set_config('${RUNTIME_ROLE_GUC}', '${APP_RUNTIME_ROLE}', false)`);
  await client.exec(`select set_config('${RUNTIME_ROLE_PASSWORD_GUC}', 'test-runtime-password', false)`);
  try {
    await client.exec(await readFile(resolve(migrationsDir, "0010_db_roles.sql"), "utf8"));
  } finally {
    await client.exec(`select set_config('${RUNTIME_ROLE_GUC}', '', false)`);
    await client.exec(`select set_config('${RUNTIME_ROLE_PASSWORD_GUC}', '', false)`);
  }
}

export async function assertRlsCoverage(client) {
  const [tables, policies] = await Promise.all([workspaceIdTables(client), tablePolicies(client)]);
  const failures = findRlsCoverageFailures(tables, policies);
  if (failures.length > 0) {
    throw new Error(formatRlsCoverageFailures(failures));
  }
  return { tables, policies, failures };
}

async function workspaceIdTables(client) {
  const result = await client.query(`
    select
      n.nspname as schema_name,
      c.relname as table_name,
      c.relrowsecurity as rls_enabled,
      c.relforcerowsecurity as rls_forced
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and a.attname = 'workspace_id'
      and not a.attisdropped
    order by n.nspname, c.relname
  `);
  return result.rows;
}

async function tablePolicies(client) {
  const result = await client.query(`
    select
      schemaname as schema_name,
      tablename as table_name,
      policyname as policy_name,
      permissive,
      qual,
      with_check
    from pg_policies
    where schemaname = 'public'
    order by schemaname, tablename, policyname
  `);
  return result.rows;
}

export function findRlsCoverageFailures(tables, policies) {
  return tables
    .map((table) => ({
      table,
      missing: missingCoverageForTable(table, policiesForTable(policies, table)),
    }))
    .filter((item) => item.missing.length > 0);
}

function policiesForTable(policies, table) {
  return policies.filter(
    (policy) => policy.schema_name === table.schema_name && policy.table_name === table.table_name,
  );
}

function missingCoverageForTable(table, policies) {
  const missing = [];
  if (!table.rls_enabled) {
    missing.push("ENABLE ROW LEVEL SECURITY");
  }
  if (!table.rls_forced) {
    missing.push("FORCE ROW LEVEL SECURITY");
  }
  if (!policies.some(isTenantPolicy)) {
    missing.push("tenant policy binding workspace_id to app.workspace_id");
  }
  const unsafePermissivePolicies = policies.filter(isUnsafePermissivePolicy);
  if (unsafePermissivePolicies.length > 0) {
    missing.push(
      `no broad permissive policies (${unsafePermissivePolicies
        .map((policy) => policy.policy_name)
        .join(", ")})`,
    );
  }
  return missing;
}

function isTenantPolicy(policy) {
  return isTenantPredicate(policy.qual) && isTenantPredicate(policy.with_check);
}

function isTenantPredicate(predicate) {
  const normalized = normalizePredicate(predicate);
  return (
    normalized === "workspace_id = current_setting('app.workspace_id', true)" ||
    normalized === "current_setting('app.workspace_id', true) = workspace_id"
  );
}

function isUnsafePermissivePolicy(policy) {
  return isPermissivePolicy(policy) && !isAllowedPermissivePolicy(policy);
}

function isPermissivePolicy(policy) {
  return String(policy.permissive ?? "PERMISSIVE").toUpperCase() === "PERMISSIVE";
}

function isAllowedPermissivePolicy(policy) {
  const predicates = [policy.qual, policy.with_check].filter((predicate) => predicate != null);
  return predicates.length > 0 && predicates.every(isAllowedPermissivePredicate);
}

function isAllowedPermissivePredicate(predicate) {
  return isTenantPredicate(predicate) || isPlatformPredicate(predicate);
}

function isPlatformPredicate(predicate) {
  const normalized = normalizePredicate(predicate);
  return normalized === "current_setting('app.platform', true) = 'on'";
}

function normalizePredicate(predicate) {
  const normalized = String(predicate ?? "")
    .replace(/::text\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/,\s*true/g, ", true")
    .replace(/\s*=\s*/g, " = ")
    .replace(/\((workspace_id)\)/g, "$1")
    .replace(/\((current_setting\('[^']+', true\))\)/g, "$1");
  return stripOuterParentheses(normalized);
}

function stripOuterParentheses(value) {
  let current = value;
  while (isWrappedInParentheses(current)) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

function isWrappedInParentheses(value) {
  if (!value.startsWith("(") || !value.endsWith(")")) {
    return false;
  }
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && index < value.length - 1) {
        return false;
      }
    }
  }
  return depth === 0;
}

export function formatRlsCoverageFailures(failures) {
  const lines = failures.map(
    ({ table, missing }) => `- ${table.schema_name}.${table.table_name}: ${missing.join(", ")}`,
  );
  return [`RLS coverage check failed for workspace_id table(s):`, ...lines].join("\n");
}

function isMain(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl);
}
