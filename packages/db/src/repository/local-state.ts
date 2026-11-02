import type {
  AccessLink,
  AgentAuthAccessToken,
  AgentAuthDelegation,
  AgentAuthJti,
  AgentAuthRegistration,
  ApiKey,
  Artifact,
  ClaimToken,
  ContentBlob,
  ContentBlobChunk,
  Feedback,
  OperationEvent,
  PlatformLockdown,
  Revision,
  SafetyWarning,
  StoredFile,
  UploadSession,
  UploadSessionChunk,
  UploadSessionDeletion,
  Workspace,
  WorkspaceMember,
} from "../types.js";

// The in-memory tables backing the local repository. They stay plain public Maps so
// tests and the local MVP server can seed and inspect rows directly.
export type LocalState = {
  uploadSessionChunks: Map<string, UploadSessionChunk>;
  uploadSessionDeletions: Map<string, UploadSessionDeletion>;
  contentBlobChunks: Map<string, ContentBlobChunk>;
  feedback: Map<string, Feedback>;
  workspaces: Map<string, Workspace>;
  workspaceMembers: Map<string, WorkspaceMember>;
  agentAuthDelegations: Map<string, AgentAuthDelegation>;
  agentAuthRegistrations: Map<string, AgentAuthRegistration>;
  agentAuthJtis: Map<string, AgentAuthJti>;
  agentAuthAccessTokens: Map<string, AgentAuthAccessToken>;
  apiKeys: Map<string, ApiKey>;
  artifacts: Map<string, Artifact>;
  revisions: Map<string, Revision>;
  artifactFiles: Map<string, StoredFile>;
  uploadSessions: Map<string, UploadSession>;
  uploadSessionFiles: Map<string, StoredFile>;
  operationEvents: Map<string, OperationEvent>;
  platformLockdowns: Map<string, PlatformLockdown>;
  accessLinks: Map<string, AccessLink>;
  safetyWarnings: Map<string, SafetyWarning>;
  claimTokens: Map<string, ClaimToken>;
  contentBlobs: Map<string, ContentBlob>;
};

export function createLocalState(): LocalState {
  return {
    uploadSessionChunks: new Map(),
    uploadSessionDeletions: new Map(),
    contentBlobChunks: new Map(),
    feedback: new Map(),
    workspaces: new Map(),
    workspaceMembers: new Map(),
    agentAuthDelegations: new Map(),
    agentAuthRegistrations: new Map(),
    agentAuthJtis: new Map(),
    agentAuthAccessTokens: new Map(),
    apiKeys: new Map(),
    artifacts: new Map(),
    revisions: new Map(),
    artifactFiles: new Map(),
    uploadSessions: new Map(),
    uploadSessionFiles: new Map(),
    operationEvents: new Map(),
    platformLockdowns: new Map(),
    accessLinks: new Map(),
    safetyWarnings: new Map(),
    claimTokens: new Map(),
    contentBlobs: new Map(),
  };
}
