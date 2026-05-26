import { describe, expect, it } from "vitest";
import {
  APP_RUNTIME_ROLE,
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
