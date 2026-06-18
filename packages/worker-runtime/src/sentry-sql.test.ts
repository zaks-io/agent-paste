import * as Sentry from "@sentry/cloudflare";
import { describe, expect, it, vi } from "vitest";
import {
  createSentryPostgresQueryInstrumentation,
  sentryPostgresExecutorOptions,
  sentrySqlStatement,
} from "./sentry-sql.js";

describe("sentryPostgresQueryInstrumentation", () => {
  it("creates Sentry-compatible spans for Postgres queries", async () => {
    const startSpan = vi.fn((_options, callback: () => Promise<string>) => callback());
    const instrument = createSentryPostgresQueryInstrumentation(startSpan);

    await expect(
      instrument(
        {
          sql: "\n select *  from artifacts where id = $1 ",
          params: ["art_1"],
          connection: {
            databaseName: "agent_paste_preview",
            serverAddress: "ep-test.neon.tech",
            serverPort: 5432,
          },
        },
        async () => "ok",
      ),
    ).resolves.toBe("ok");

    expect(startSpan).toHaveBeenCalledWith(
      {
        name: "select * from artifacts where id = $1",
        op: "db",
        attributes: {
          "db.name": "agent_paste_preview",
          "db.namespace": "agent_paste_preview",
          "db.operation": "SELECT",
          "db.operation.name": "SELECT",
          "db.query.text": "select * from artifacts where id = $1",
          "db.system": "postgresql",
          "db.system.name": "postgresql",
          "server.address": "ep-test.neon.tech",
          "server.port": 5432,
        },
      },
      expect.any(Function),
    );
  });

  it("adds query source attributes from explicit source metadata", async () => {
    const startSpan = vi.fn((_options, callback: () => Promise<string>) => callback());
    const instrument = createSentryPostgresQueryInstrumentation(startSpan);

    await expect(
      instrument(
        {
          sql: "select * from workspace_members where workos_user_id = $1",
          params: ["user_1"],
          source: {
            filepath: "packages/db/src/queries/workspace-members.ts",
            functionName: "workspaceMemberQueries.findByWorkOsUserId",
            namespace: "packages.db.src.queries.workspace-members",
          },
        },
        async () => "ok",
      ),
    ).resolves.toBe("ok");

    expect(startSpan).toHaveBeenCalledWith(
      {
        name: "select * from workspace_members where workos_user_id = $1",
        op: "db",
        attributes: expect.objectContaining({
          "code.filepath": "packages/db/src/queries/workspace-members.ts",
          "code.function": "workspaceMemberQueries.findByWorkOsUserId",
          "code.namespace": "packages.db.src.queries.workspace-members",
        }),
      },
      expect.any(Function),
    );
  });

  it("skips RLS setup queries", async () => {
    const startSpan = vi.fn((_options, callback: () => Promise<string>) => callback());
    const instrument = createSentryPostgresQueryInstrumentation(startSpan);

    await expect(
      instrument({ sql: "select set_config('app.workspace_id', $1, true)", params: ["ws_1"] }, async () => "ok"),
    ).resolves.toBe("ok");

    expect(startSpan).not.toHaveBeenCalled();
  });

  it.each([
    "BEGIN",
    "COMMIT",
    "END",
    "ROLLBACK",
    "SAVEPOINT drizzle_tx",
    "RELEASE SAVEPOINT drizzle_tx",
    "ROLLBACK TO SAVEPOINT drizzle_tx",
    "START TRANSACTION",
  ])("skips transaction control statement %s", async (sql) => {
    const startSpan = vi.fn((_options, callback: () => Promise<string>) => callback());
    const instrument = createSentryPostgresQueryInstrumentation(startSpan);

    await expect(instrument({ sql, params: [] }, async () => "ok")).resolves.toBe("ok");

    expect(startSpan).not.toHaveBeenCalled();
  });

  it("exposes the active Sentry trace id for Postgres session context", () => {
    expect(sentryPostgresExecutorOptions.traceId?.()).toBeUndefined();

    Sentry.startSpan({ name: "test trace", op: "test" }, () => {
      expect(sentryPostgresExecutorOptions.traceId?.()).toMatch(/^[a-f0-9]{32}$/);
    });
  });
});

describe("sentrySqlStatement", () => {
  it("normalizes whitespace without changing placeholders", () => {
    expect(sentrySqlStatement(" SELECT  *\nFROM users\nWHERE id = $1 ")).toBe("SELECT * FROM users WHERE id = $1");
  });
});
