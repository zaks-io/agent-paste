/** @typedef {"preview" | "production"} MigrationTarget */

export const APP_RUNTIME_ROLE = "app_role";
export const MIGRATION_ROLE = "platform_admin";

const LEGACY_MIGRATION_ENV = {
  preview: "PREVIEW_DATABASE_URL",
  production: "PRODUCTION_DATABASE_URL",
};

const MIGRATION_ENV = {
  preview: "DATABASE_URL_MIGRATIONS_PREVIEW",
  production: "DATABASE_URL_MIGRATIONS_PRODUCTION",
};

const RUNTIME_ENV = {
  preview: "DATABASE_URL_RUNTIME_PREVIEW",
  production: "DATABASE_URL_RUNTIME_PRODUCTION",
};

/**
 * Resolves the env var that holds the migration (platform_admin) connection string.
 *
 * @param {MigrationTarget} target
 * @param {NodeJS.ProcessEnv} [env]
 */
export function migrationDatabaseUrlEnvName(target, env = process.env) {
  const canonical = MIGRATION_ENV[target];
  if (env[canonical]) {
    return canonical;
  }
  if (target === "production" && env.DATABASE_URL_MIGRATIONS_LIVE) {
    return "DATABASE_URL_MIGRATIONS_LIVE";
  }
  const legacy = LEGACY_MIGRATION_ENV[target];
  if (env[legacy]) {
    return legacy;
  }
  if (target === "production" && env.LIVE_DATABASE_URL) {
    return "LIVE_DATABASE_URL";
  }
  return canonical;
}

/**
 * @param {MigrationTarget} target
 * @param {NodeJS.ProcessEnv} [env]
 */
export function runtimeDatabaseUrlEnvName(target, env = process.env) {
  return RUNTIME_ENV[target];
}

/**
 * @param {MigrationTarget} target
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveMigrationDatabaseUrl(target, env = process.env) {
  const envName = migrationDatabaseUrlEnvName(target, env);
  const url = env[envName];
  if (!url) {
    throw new Error(`Set ${envName} before running ${target} migrations.`);
  }
  return { envName, url };
}

/**
 * @param {MigrationTarget} target
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveRuntimeDatabaseUrl(target, env = process.env) {
  const envName = runtimeDatabaseUrlEnvName(target, env);
  const url = env[envName];
  if (!url) {
    throw new Error(`Set ${envName} for the ${target} Hyperdrive runtime connection.`);
  }
  return { envName, url };
}

/**
 * True when a legacy migration env var is in use instead of DATABASE_URL_MIGRATIONS_*.
 *
 * @param {MigrationTarget} target
 * @param {string} selectedEnv
 */
export function usesLegacyMigrationEnv(target, selectedEnv) {
  return selectedEnv === LEGACY_MIGRATION_ENV[target] || selectedEnv === "LIVE_DATABASE_URL";
}

/**
 * Build a direct Postgres URL for a Neon role using the host/database from a bootstrap URL.
 *
 * @param {string} bootstrapUrl
 * @param {string} roleName
 * @param {string} password
 */
export function connectionStringForRole(bootstrapUrl, roleName, password) {
  const url = new URL(bootstrapUrl);
  url.username = roleName;
  url.password = password;
  return url.toString();
}

/**
 * @param {string} uri
 */
export function connectionUriHasPassword(uri) {
  try {
    const parsed = new URL(uri);
    return parsed.password.length > 0;
  } catch {
    return false;
  }
}

/**
 * @param {string} uri
 */
export function maskConnectionUri(uri) {
  try {
    const parsed = new URL(uri);
    const user = parsed.username ? `${parsed.username}:***@` : "";
    return `${parsed.protocol}//${user}${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return "<invalid-uri>";
  }
}
