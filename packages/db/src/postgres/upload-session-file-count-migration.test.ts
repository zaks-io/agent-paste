import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.AGENT_PASTE_POSTGRES_MIGRATION_TEST_URL;
const migration = await readFile(
  new URL("../../migrations/0032_upload_session_file_count_nonnegative.sql", import.meta.url),
  "utf8",
);
const replacement = migration.slice(0, migration.indexOf("\ncommit;") + "\ncommit;".length);
type Constraint = { oid: number; convalidated: boolean; expression: string };
const constraintQuery = `select oid, convalidated, pg_get_expr(conbin, conrelid) as expression
  from pg_constraint where conrelid = 'upload_sessions'::regclass
  and conname = 'upload_sessions_file_count_check'`;

describe(`upload session CHECK migration (${databaseUrl ? "PostgreSQL" : "PGlite"})`, () => {
  let execute: (query: string) => Promise<void>;
  let read: (query: string) => Promise<Constraint[]>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    if (databaseUrl) {
      const client = postgres(databaseUrl, { max: 1, prepare: false });
      const schema = `upload_count_test_${crypto.randomUUID().replaceAll("-", "")}`;
      execute = async (query) => {
        await client.unsafe(query);
      };
      read = async (query) => [...(await client.unsafe<Constraint[]>(query))];
      close = async () => {
        try {
          await client.unsafe(`drop schema if exists ${schema} cascade`);
        } finally {
          await client.end({ timeout: 5 });
        }
      };
      await execute(`create schema ${schema}; set search_path to ${schema}`);
    } else {
      const client = new PGlite();
      execute = async (query) => {
        await client.exec(query);
      };
      read = async (query) => (await client.query<Constraint>(query)).rows;
      close = () => client.close();
    }
  }, 30_000);

  beforeEach(async () => {
    await execute(`drop table if exists upload_sessions;
      create table upload_sessions (file_count integer not null check (file_count > 0));
      insert into upload_sessions values (1)`);
  });

  afterAll(async () => {
    await close?.();
  });

  it("upgrades the old CHECK and reuses the validated constraint on reruns", async () => {
    await execute(migration);
    const before = await read(constraintQuery);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ convalidated: true, expression: "(file_count >= 0)" });
    await execute("insert into upload_sessions values (0)");
    await expect(execute("insert into upload_sessions values (-1)")).rejects.toThrow(
      "upload_sessions_file_count_check",
    );
    await execute(migration);
    expect(await read(constraintQuery)).toEqual(before);
  });

  it("resumes validation after interruption without replacing the unvalidated CHECK", async () => {
    await execute(replacement);
    const before = await read(constraintQuery);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ convalidated: false, expression: "(file_count >= 0)" });
    await execute("insert into upload_sessions values (0)");
    await expect(execute("insert into upload_sessions values (-1)")).rejects.toThrow(
      "upload_sessions_file_count_check",
    );
    await execute(migration);
    expect(await read(constraintQuery)).toEqual(before.map((row) => ({ ...row, convalidated: true })));
  });
});
