import { describe, expect, it } from "vitest";
import {
  APP_RUNTIME_ROLE,
  connectionStringForRole,
  connectionUriHasPassword,
  maskConnectionUri,
  MIGRATION_ROLE,
  migrationDatabaseUrlEnvName,
  resolveMigrationDatabaseUrl,
  runtimeDatabaseUrlEnvName,
  usesLegacyMigrationEnv,
} from "./credentials.mjs";

describe("database credentials", () => {
  it("exposes stable role names", () => {
    expect(APP_RUNTIME_ROLE).toBe("app_role");
    expect(MIGRATION_ROLE).toBe("platform_admin");
  });

  it("prefers canonical migration env vars", () => {
    expect(
      migrationDatabaseUrlEnvName("preview", {
        PREVIEW_DATABASE_URL: "legacy",
        DATABASE_URL_MIGRATIONS_PREVIEW: "canonical",
      }),
    ).toBe("DATABASE_URL_MIGRATIONS_PREVIEW");
    expect(
      migrationDatabaseUrlEnvName("production", {
        PRODUCTION_DATABASE_URL: "legacy",
        DATABASE_URL_MIGRATIONS_PRODUCTION: "canonical",
      }),
    ).toBe("DATABASE_URL_MIGRATIONS_PRODUCTION");
  });

  it("falls back to legacy migration env vars", () => {
    expect(migrationDatabaseUrlEnvName("preview", { PREVIEW_DATABASE_URL: "x" })).toBe("PREVIEW_DATABASE_URL");
    expect(migrationDatabaseUrlEnvName("production", { PRODUCTION_DATABASE_URL: "x" })).toBe(
      "PRODUCTION_DATABASE_URL",
    );
  });

  it("returns canonical names when unset", () => {
    expect(migrationDatabaseUrlEnvName("preview", {})).toBe("DATABASE_URL_MIGRATIONS_PREVIEW");
    expect(runtimeDatabaseUrlEnvName("production", {})).toBe("DATABASE_URL_RUNTIME_PRODUCTION");
  });

  it("does not resolve preview migration env vars for production", () => {
    expect(
      migrationDatabaseUrlEnvName("production", {
        DATABASE_URL_MIGRATIONS_PREVIEW: "postgres://preview@host/db",
        PREVIEW_DATABASE_URL: "postgres://legacy-preview@host/db",
      }),
    ).toBe("DATABASE_URL_MIGRATIONS_PRODUCTION");
    expect(() =>
      resolveMigrationDatabaseUrl("production", {
        DATABASE_URL_MIGRATIONS_PREVIEW: "postgres://preview@host/db",
      }),
    ).toThrow(/DATABASE_URL_MIGRATIONS_PRODUCTION/);
  });

  it("does not resolve production migration env vars for preview", () => {
    expect(
      migrationDatabaseUrlEnvName("preview", {
        DATABASE_URL_MIGRATIONS_PRODUCTION: "postgres://production@host/db",
        PRODUCTION_DATABASE_URL: "postgres://legacy-production@host/db",
      }),
    ).toBe("DATABASE_URL_MIGRATIONS_PREVIEW");
    expect(() =>
      resolveMigrationDatabaseUrl("preview", {
        DATABASE_URL_MIGRATIONS_PRODUCTION: "postgres://production@host/db",
      }),
    ).toThrow(/DATABASE_URL_MIGRATIONS_PREVIEW/);
  });

  it("detects passwordless Neon connection URIs", () => {
    expect(connectionUriHasPassword("postgres://app_role@ep-test.neon.tech/neondb?sslmode=require")).toBe(false);
    expect(
      connectionUriHasPassword("postgres://app_role:secret@ep-test.neon.tech/neondb?sslmode=require"),
    ).toBe(true);
  });

  it("masks connection URIs for logs", () => {
    expect(maskConnectionUri("postgres://app_role:secret@ep-test.neon.tech/neondb?sslmode=require")).toBe(
      "postgres://app_role:***@ep-test.neon.tech/neondb?sslmode=require",
    );
  });

  it("builds a runtime connection string from a bootstrap URL", () => {
    const url = connectionStringForRole(
      "postgres://neondb_owner:owner-secret@ep-test.us-east-2.aws.neon.tech/neondb?sslmode=require",
      APP_RUNTIME_ROLE,
      "runtime-secret",
    );
    const parsed = new URL(url);
    expect(parsed.username).toBe(APP_RUNTIME_ROLE);
    expect(parsed.password).toBe("runtime-secret");
    expect(parsed.hostname).toBe("ep-test.us-east-2.aws.neon.tech");
  });

  it("resolves migration URLs and flags legacy env names", () => {
    const resolved = resolveMigrationDatabaseUrl("production", {
      PRODUCTION_DATABASE_URL: "postgres://platform_admin@host/db",
    });
    expect(resolved.url).toContain("platform_admin");
    expect(usesLegacyMigrationEnv("production", resolved.envName)).toBe(true);
    expect(
      usesLegacyMigrationEnv(
        "production",
        resolveMigrationDatabaseUrl("production", {
          DATABASE_URL_MIGRATIONS_PRODUCTION: "postgres://platform_admin@host/db",
        }).envName,
      ),
    ).toBe(false);
  });
});
