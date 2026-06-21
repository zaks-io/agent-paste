import { localAccessLinks } from "./local-entities/access-links.js";
import { localAgentAuth } from "./local-entities/agent-auth.js";
import { localApiKeys } from "./local-entities/api-keys.js";
import { localArtifactFiles } from "./local-entities/artifact-files.js";
import { localArtifacts } from "./local-entities/artifacts.js";
import { localClaimTokens } from "./local-entities/claim-tokens.js";
import { localContentBlobs } from "./local-entities/content-blobs.js";
import { localMembers } from "./local-entities/members.js";
import { localOperationEvents } from "./local-entities/operation-events.js";
import { localPlatformLockdowns } from "./local-entities/platform-lockdowns.js";
import { localRevisions } from "./local-entities/revisions.js";
import { localSafetyWarnings } from "./local-entities/safety-warnings.js";
import { localUploadSessionFiles } from "./local-entities/upload-session-files.js";
import { localUploadSessions } from "./local-entities/upload-sessions.js";
import { localWorkspaces } from "./local-entities/workspaces.js";
import type { LocalState } from "./local-state.js";
import type { Entities } from "./ports.js";

// Compose the grouped Entities accessor from per-collection local adapters.
export function localEntities(state: LocalState): Entities {
  return {
    workspaces: localWorkspaces(state),
    apiKeys: localApiKeys(state),
    agentAuth: localAgentAuth(state),
    claimTokens: localClaimTokens(state),
    contentBlobs: localContentBlobs(state),
    members: localMembers(state),
    artifacts: localArtifacts(state),
    accessLinks: localAccessLinks(state),
    revisions: localRevisions(state),
    artifactFiles: localArtifactFiles(state),
    safetyWarnings: localSafetyWarnings(state),
    uploadSessions: localUploadSessions(state),
    uploadSessionFiles: localUploadSessionFiles(state),
    platformLockdowns: localPlatformLockdowns(state),
    operationEvents: localOperationEvents(state),
  };
}
