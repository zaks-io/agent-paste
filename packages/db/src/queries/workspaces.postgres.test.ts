import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "../schema.js";
import { workspaceQueries } from "./workspaces.js";

const workspaceId = "11111111-1111-1111-1111-111111111111";

describe("workspaceQueries markClaimed", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    const client = new PGlite();
    await client.exec(`
      create table workspaces (
        id uuid primary key,
        name text not null,
        contact_email text,
        plan text not null default 'free',
        plan_operator_override_at timestamptz,
        claimed_at timestamptz,
        auto_deletion_days integer not null default 30,
        revision_retention_days integer,
        created_at timestamptz not null,
        updated_at timestamptz not null
      );
    `);
    db = drizzle(client, { schema });
    const now = new Date("2026-01-01T00:00:00.000Z");
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: "Ephemeral",
      contactEmail: null,
      plan: "free",
      claimedAt: null,
      autoDeletionDays: 1,
      createdAt: now,
      updatedAt: now,
    });
  }, 30_000);

  it("marks an unclaimed workspace consumed once", async () => {
    await expect(
      workspaceQueries.markClaimed(db, workspaceId, {
        claimedAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
    ).resolves.toBe(true);
    await expect(
      workspaceQueries.markClaimed(db, workspaceId, {
        claimedAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      }),
    ).resolves.toBe(false);
  });
});
