import { RepositoryCore } from "./repository/core.js";
import { createLocalState, type LocalState } from "./repository/local-state.js";
import { LocalUnitOfWork } from "./repository/local-unit-of-work.js";
import type {
  AccessLink,
  ApiKey,
  Artifact,
  OperationEvent,
  PlatformLockdown,
  RepositoryOptions,
  Revision,
  StoredFile,
  UploadSession,
  Workspace,
  WorkspaceMember,
} from "./types.js";

// In-memory Repository for local dev and tests. All domain logic lives in
// RepositoryCore; this subclass only supplies the Map-backed unit of work and keeps
// the underlying tables as public Maps so tests and the MVP server can seed/inspect them.
export class LocalRepository extends RepositoryCore {
  readonly workspaces: Map<string, Workspace>;
  readonly workspaceMembers: Map<string, WorkspaceMember>;
  readonly apiKeys: Map<string, ApiKey>;
  readonly artifacts: Map<string, Artifact>;
  readonly revisions: Map<string, Revision>;
  readonly artifactFiles: Map<string, StoredFile>;
  readonly uploadSessions: Map<string, UploadSession>;
  readonly uploadSessionFiles: Map<string, StoredFile>;
  readonly operationEvents: Map<string, OperationEvent>;
  readonly platformLockdowns: Map<string, PlatformLockdown>;
  readonly accessLinks: Map<string, AccessLink>;

  constructor(options: RepositoryOptions) {
    const state: LocalState = createLocalState();
    super(new LocalUnitOfWork(state), options);
    this.workspaces = state.workspaces;
    this.workspaceMembers = state.workspaceMembers;
    this.apiKeys = state.apiKeys;
    this.artifacts = state.artifacts;
    this.revisions = state.revisions;
    this.artifactFiles = state.artifactFiles;
    this.uploadSessions = state.uploadSessions;
    this.uploadSessionFiles = state.uploadSessionFiles;
    this.operationEvents = state.operationEvents;
    this.platformLockdowns = state.platformLockdowns;
    this.accessLinks = state.accessLinks;
  }
}

export function createLocalServices(options: RepositoryOptions) {
  const repo = new LocalRepository(options);
  return {
    repo,
    auth: {
      verifyApiKey: (apiKey: string) => repo.verifyApiKey(apiKey),
    },
    apiDb: repo,
    uploadDb: repo,
  };
}
