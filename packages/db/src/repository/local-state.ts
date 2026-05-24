import type {
  ApiKey,
  Artifact,
  OperationEvent,
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
  artifactFiles: Map<string, StoredFile>;
  uploadSessions: Map<string, UploadSession>;
  uploadSessionFiles: Map<string, StoredFile>;
  operationEvents: Map<string, OperationEvent>;
};

export function createLocalState(): LocalState {
  return {
    workspaces: new Map(),
    workspaceMembers: new Map(),
    apiKeys: new Map(),
    artifacts: new Map(),
    artifactFiles: new Map(),
    uploadSessions: new Map(),
    uploadSessionFiles: new Map(),
    operationEvents: new Map(),
  };
}
