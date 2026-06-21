import { workspaceMemberQueries } from "../../queries/index.js";
import type { Entities } from "../ports.js";
import type { PostgresContext } from "./context.js";

export function postgresMembers(ctx: PostgresContext): Entities["members"] {
  const { drizzle } = ctx;
  return {
    insert: (member) => workspaceMemberQueries.insert(drizzle, member),
    findById: (id) => workspaceMemberQueries.findById(drizzle, id),
    findByWorkOsUserId: (workosUserId) => workspaceMemberQueries.findByWorkOsUserId(drizzle, workosUserId),
    findByEmail: (email) => workspaceMemberQueries.findByEmail(drizzle, email),
    updateSeen: (id, input) => workspaceMemberQueries.updateSeen(drizzle, id, input),
    updateWorkOsUserId: (id, input) => workspaceMemberQueries.updateWorkOsUserId(drizzle, id, input),
  };
}
