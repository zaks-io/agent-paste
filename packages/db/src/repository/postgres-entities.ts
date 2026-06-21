import type { Entities } from "./ports.js";
import { postgresAccessLinks } from "./postgres-entities/access-links.js";
import { postgresAgentAuth } from "./postgres-entities/agent-auth.js";
import { postgresApiKeys } from "./postgres-entities/api-keys.js";
import { postgresArtifactFiles } from "./postgres-entities/artifact-files.js";
import { postgresArtifacts } from "./postgres-entities/artifacts.js";
import { postgresClaimTokens } from "./postgres-entities/claim-tokens.js";
import { postgresContentBlobs } from "./postgres-entities/content-blobs.js";
import type { PostgresContext } from "./postgres-entities/context.js";
import { postgresMembers } from "./postgres-entities/members.js";
import { postgresOperationEvents } from "./postgres-entities/operation-events.js";
import { postgresPlatformLockdowns } from "./postgres-entities/platform-lockdowns.js";
import { postgresRevisions } from "./postgres-entities/revisions.js";
import { postgresSafetyWarnings } from "./postgres-entities/safety-warnings.js";
import { postgresUploadSessionFiles } from "./postgres-entities/upload-session-files.js";
import { postgresUploadSessions } from "./postgres-entities/upload-sessions.js";
import { postgresWorkspaces } from "./postgres-entities/workspaces.js";

export type { PostgresContext } from "./postgres-entities/context.js";

// Bind the grouped Entities accessor to one scope-bound, drizzle-aware transaction.
// Most methods forward to the existing query objects; the cleanup/delete helpers
// keep the original raw SQL so RLS-scoped batch updates stay byte-for-byte identical.
export function postgresEntities(ctx: PostgresContext): Entities {
  return {
    workspaces: postgresWorkspaces(ctx),
    apiKeys: postgresApiKeys(ctx),
    agentAuth: postgresAgentAuth(ctx),
    claimTokens: postgresClaimTokens(ctx),
    contentBlobs: postgresContentBlobs(ctx),
    members: postgresMembers(ctx),
    artifacts: postgresArtifacts(ctx),
    accessLinks: postgresAccessLinks(ctx),
    revisions: postgresRevisions(ctx),
    artifactFiles: postgresArtifactFiles(ctx),
    safetyWarnings: postgresSafetyWarnings(ctx),
    uploadSessions: postgresUploadSessions(ctx),
    uploadSessionFiles: postgresUploadSessionFiles(ctx),
    platformLockdowns: postgresPlatformLockdowns(ctx),
    operationEvents: postgresOperationEvents(ctx),
  };
}
