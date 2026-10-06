import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../postgres/drizzle.js";
import { defineSqlQuerySourceMap } from "../postgres/query-source.js";
import { feedback } from "../schema.js";
import type { Feedback } from "../types.js";

export const feedbackQueries = defineSqlQuerySourceMap("packages/db/src/queries/feedback.ts", "feedbackQueries", {
  async insert(db: DrizzleDb, row: Feedback) {
    await db.insert(feedback).values({
      id: row.id,
      workspaceId: row.workspace_id,
      submitterKind: row.submitter_kind,
      submitterMemberId: row.submitter_member_id,
      submitterApiKeyId: row.submitter_api_key_id,
      contactEmail: row.contact_email,
      body: row.body,
      context: row.context,
      status: row.status,
      notificationSuppressed: row.notification_suppressed,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  },
  async findById(db: DrizzleDb, id: string): Promise<Feedback | null> {
    const [row] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1);
    return row
      ? {
          id: row.id,
          workspace_id: row.workspaceId,
          submitter_kind: row.submitterKind,
          submitter_member_id: row.submitterMemberId,
          submitter_api_key_id: row.submitterApiKeyId,
          contact_email: row.contactEmail,
          body: row.body,
          context: row.context,
          status: row.status,
          notification_suppressed: row.notificationSuppressed,
          created_at: row.createdAt.toISOString(),
          updated_at: row.updatedAt.toISOString(),
        }
      : null;
  },
});
