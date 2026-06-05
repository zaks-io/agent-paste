import { uploadSessionQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresUploadSessions(ctx: PostgresContext): Entities["uploadSessions"] {
  const { sql, drizzle } = ctx;
  return {
    insert: (session) => uploadSessionQueries.insert(drizzle, session),
    findById: (sessionId, workspaceId) => uploadSessionQueries.findById(drizzle, sessionId, workspaceId),
    findByRevisionId: (revisionId, workspaceId) =>
      uploadSessionQueries.findByRevisionId(drizzle, revisionId, workspaceId),
    markFinalized: (sessionId, finalizedAt) => uploadSessionQueries.markFinalized(drizzle, sessionId, finalizedAt),
    listExpiring: async (now, limit) => {
      const result = await sql.query<{ id: string }>(
        `select id
         from upload_sessions
         where status = 'pending' and expires_at <= $1
         order by expires_at asc
         limit $2`,
        [now, limit],
      );
      return result.rows;
    },
    expireBatch: async (now, ids) => {
      await sql.query(
        `update upload_sessions
         set status = 'expired'
         where status = 'pending' and expires_at <= $1 and id = any($2::text[])`,
        [now, ids],
      );
    },
  };
}
