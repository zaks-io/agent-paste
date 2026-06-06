import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  assertRlsCoverage,
  findRlsCoverageFailures,
  runRlsCoverageCheck,
} from "./check-rls-coverage.mjs";

describe("RLS coverage check", () => {
  it("passes for committed migrations", { timeout: 30_000 }, async () => {
    const result = await runRlsCoverageCheck({ log: () => {} });

    const tableNames = result.tables.map((table) => table.table_name);
    expect(tableNames).toContain("artifacts");
    expect(tableNames).toContain("claim_tokens");
    expect(result.failures).toEqual([]);
  });

  it("fails on a deliberately policy-less workspace_id table", { timeout: 30_000 }, async () => {
    const client = new PGlite();
    try {
      await applyMigrations(client);
      await client.exec(`
        create table policyless_workspace_rows (
          id text primary key,
          workspace_id uuid not null
        )
      `);

      await expect(assertRlsCoverage(client)).rejects.toThrow(
        /policyless_workspace_rows[\s\S]*FORCE ROW LEVEL SECURITY[\s\S]*tenant policy/,
      );
    } finally {
      await client.close();
    }
  });

  it("flags weakened tenant policies", () => {
    expect(
      findRlsCoverageFailures(
        [
          {
            schema_name: "public",
            table_name: "example_rows",
            rls_enabled: true,
            rls_forced: true,
          },
        ],
        [
          {
            schema_name: "public",
            table_name: "example_rows",
            policy_name: "example_rows_tenant",
            permissive: "PERMISSIVE",
            qual: "workspace_id is not null and current_setting('app.workspace_id', true) is not null",
            with_check:
              "workspace_id is not null and current_setting('app.workspace_id', true) is not null",
          },
        ],
      ),
    ).toEqual([
      {
        table: {
          schema_name: "public",
          table_name: "example_rows",
          rls_enabled: true,
          rls_forced: true,
        },
        missing: [
          "tenant policy binding workspace_id to app.workspace_id",
          "no broad permissive policies (example_rows_tenant)",
        ],
      },
    ]);
  });

  it("flags broad permissive policies even when a tenant policy exists", () => {
    expect(
      findRlsCoverageFailures(
        [
          {
            schema_name: "public",
            table_name: "example_rows",
            rls_enabled: true,
            rls_forced: true,
          },
        ],
        [
          {
            schema_name: "public",
            table_name: "example_rows",
            policy_name: "example_rows_tenant",
            permissive: "PERMISSIVE",
            qual: "workspace_id::text = current_setting('app.workspace_id', true)",
            with_check: "workspace_id::text = current_setting('app.workspace_id', true)",
          },
          {
            schema_name: "public",
            table_name: "example_rows",
            policy_name: "example_rows_open",
            permissive: "PERMISSIVE",
            qual: "true",
            with_check: "true",
          },
        ],
      ),
    ).toEqual([
      {
        table: {
          schema_name: "public",
          table_name: "example_rows",
          rls_enabled: true,
          rls_forced: true,
        },
        missing: ["no broad permissive policies (example_rows_open)"],
      },
    ]);
  });
});
