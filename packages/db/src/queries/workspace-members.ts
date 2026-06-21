import { eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { defineSqlQuerySourceMap } from "../postgres/query-source.js";
import { workspaceMembers } from "../schema.js";
import type { WorkspaceMember } from "../types.js";

export const workspaceMemberQueries = defineSqlQuerySourceMap(
  "packages/db/src/queries/workspace-members.ts",
  "workspaceMemberQueries",
  {
    async insert(db: DrizzleDb, row: WorkspaceMember) {
      await db.insert(workspaceMembers).values({
        id: row.id,
        workspaceId: row.workspace_id,
        workosUserId: row.workos_user_id,
        email: row.email,
        scopes: row.scopes,
        createdAt: new Date(row.created_at),
        lastSeenAt: new Date(row.last_seen_at),
      });
    },

    async findByWorkOsUserId(db: DrizzleDb, workosUserId: string): Promise<WorkspaceMember | null> {
      const rows = await db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workosUserId, workosUserId))
        .limit(1);
      const row = rows[0];
      return row ? mapWorkspaceMember(row) : null;
    },

    async findByEmail(db: DrizzleDb, email: string): Promise<WorkspaceMember[]> {
      const rows = await db
        .select()
        .from(workspaceMembers)
        .where(sql`lower(${workspaceMembers.email}) = lower(${email})`);
      return rows.map(mapWorkspaceMember);
    },

    async findById(db: DrizzleDb, id: string): Promise<WorkspaceMember | null> {
      const rows = await db.select().from(workspaceMembers).where(eq(workspaceMembers.id, id)).limit(1);
      const row = rows[0];
      return row ? mapWorkspaceMember(row) : null;
    },

    async updateSeen(db: DrizzleDb, id: string, input: { email: string; lastSeenAt: string }) {
      const rows = await db
        .update(workspaceMembers)
        .set({ email: input.email, lastSeenAt: new Date(input.lastSeenAt) })
        .where(eq(workspaceMembers.id, id))
        .returning();
      const row = rows[0];
      return row ? mapWorkspaceMember(row) : null;
    },

    async updateWorkOsUserId(
      db: DrizzleDb,
      id: string,
      input: { workosUserId: string; email: string; lastSeenAt: string },
    ) {
      const rows = await db
        .update(workspaceMembers)
        .set({ workosUserId: input.workosUserId, email: input.email, lastSeenAt: new Date(input.lastSeenAt) })
        .where(eq(workspaceMembers.id, id))
        .returning();
      const row = rows[0];
      return row ? mapWorkspaceMember(row) : null;
    },
  },
);

function mapWorkspaceMember(row: typeof workspaceMembers.$inferSelect): WorkspaceMember {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    workos_user_id: row.workosUserId,
    email: row.email,
    scopes: row.scopes,
    created_at: row.createdAt.toISOString(),
    last_seen_at: row.lastSeenAt.toISOString(),
  };
}
