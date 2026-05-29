import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { workspaces } from "../schema.js";
import type { Workspace } from "../types.js";

export const workspaceQueries = {
  async insert(db: DrizzleDb, row: Workspace) {
    await db.insert(workspaces).values({
      id: row.id,
      name: row.name,
      contactEmail: row.contact_email,
      plan: row.plan,
      autoDeletionDays: row.auto_deletion_days,
      revisionRetentionDays: row.revision_retention_days,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  },

  async findById(db: DrizzleDb, id: string): Promise<Workspace | null> {
    const rows = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    const row = rows[0];
    return row ? mapWorkspace(row) : null;
  },

  async listAll(db: DrizzleDb): Promise<Workspace[]> {
    const rows = await db.select().from(workspaces);
    return rows.map(mapWorkspace).sort((left, right) => right.created_at.localeCompare(left.created_at));
  },

  async update(db: DrizzleDb, id: string, input: { name: string; autoDeletionDays: number; updatedAt: string }) {
    await db
      .update(workspaces)
      .set({ name: input.name, autoDeletionDays: input.autoDeletionDays, updatedAt: new Date(input.updatedAt) })
      .where(eq(workspaces.id, id));
  },
};

function mapWorkspace(row: typeof workspaces.$inferSelect): Workspace {
  return {
    id: row.id,
    name: row.name,
    contact_email: row.contactEmail,
    plan: row.plan as Workspace["plan"],
    auto_deletion_days: row.autoDeletionDays,
    revision_retention_days: row.revisionRetentionDays,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
