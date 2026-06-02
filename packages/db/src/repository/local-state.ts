import type {
  AccessLink,
  ApiKey,
  Artifact,
  ClaimToken,
  OperationEvent,
  PlatformLockdown,
  Revision,
  SafetyWarning,
  StoredFile,
  UploadSession,
  Workspace,
  WorkspaceMember,
} from "../types.js";

// The in-memory tables backing the local repository. They stay plain public Maps so
// tests and the local MVP server can seed and inspect rows directly.
export type LocalState = {
  workspaces: Map<string, Workspace>;
  workspaceMembers: Map<string, WorkspaceMember>;
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
};

export function createLocalState(): LocalState {
  return {
    workspaces: new Map(),
    workspaceMembers: new Map(),
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
  };
}
