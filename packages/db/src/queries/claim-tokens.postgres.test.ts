import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "../schema.js";
import { claimTokenQueries } from "./claim-tokens.js";

const here = dirname(fileURLToPath(import.meta.url));
const workspaceId = "11111111-1111-1111-1111-111111111111";

describe("claimTokenQueries bytea round-trip", () => {
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
    const migration = await readFile(
      resolve(here, "../../migrations/0018_ephemeral_workspace_claim_tokens.sql"),
      "utf8",
    );
    await client.exec(migration);
    const publicIdMigration = await readFile(resolve(here, "../../migrations/0019_claim_tokens_public_id.sql"), "utf8");
    await client.exec(publicIdMigration);
    db = drizzle(client, { schema });
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: "ws",
      contactEmail: null,
      plan: "free",
      claimedAt: null,
      autoDeletionDays: 1,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  }, 30_000);

  it("preserves token_hash bytes when read through Drizzle", async () => {
    const tokenHash = new Uint8Array([9, 8, 7, 6, 5]);
    const row = {
      id: "ct_00000000000000000000000001",
      workspace_id: workspaceId,
      public_id: "ABCDEFGHJKLMNP12",
      token_hash: tokenHash,
      pepper_kid: 1,
      expires_at: "2026-01-02T00:00:00.000Z",
      redeemed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    await claimTokenQueries.insert(db, row);
    const loaded = await claimTokenQueries.findById(db, row.id);
    expect(loaded?.token_hash).toEqual(tokenHash);
    await expect(claimTokenQueries.findByPublicId(db, row.public_id)).resolves.toMatchObject({ id: row.id });
    await expect(claimTokenQueries.markRedeemed(db, row.id, "2026-01-03T00:00:00.000Z")).resolves.toBe(true);
    await expect(claimTokenQueries.markRedeemed(db, row.id, "2026-01-04T00:00:00.000Z")).resolves.toBe(false);
  });
});
