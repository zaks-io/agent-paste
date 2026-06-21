import { RepositoryCore } from "./repository/core.js";
import { createLocalState, type LocalState } from "./repository/local-state.js";
import { LocalUnitOfWork } from "./repository/local-unit-of-work.js";
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
  OperationEvent,
  PlatformLockdown,
  RepositoryOptions,
  Revision,
  SafetyWarning,
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
  readonly agentAuthDelegations: Map<string, AgentAuthDelegation>;
  readonly agentAuthRegistrations: Map<string, AgentAuthRegistration>;
  readonly agentAuthJtis: Map<string, AgentAuthJti>;
  readonly agentAuthAccessTokens: Map<string, AgentAuthAccessToken>;
  readonly apiKeys: Map<string, ApiKey>;
  readonly artifacts: Map<string, Artifact>;
  readonly revisions: Map<string, Revision>;
  readonly artifactFiles: Map<string, StoredFile>;
  readonly uploadSessions: Map<string, UploadSession>;
  readonly uploadSessionFiles: Map<string, StoredFile>;
  readonly operationEvents: Map<string, OperationEvent>;
  readonly platformLockdowns: Map<string, PlatformLockdown>;
  readonly accessLinks: Map<string, AccessLink>;
  readonly safetyWarnings: Map<string, SafetyWarning>;
  readonly claimTokens: Map<string, ClaimToken>;
  readonly contentBlobs: Map<string, ContentBlob>;

  constructor(options: RepositoryOptions) {
    const state: LocalState = createLocalState();
    super(new LocalUnitOfWork(state), options);
    this.workspaces = state.workspaces;
    this.workspaceMembers = state.workspaceMembers;
    this.agentAuthDelegations = state.agentAuthDelegations;
    this.agentAuthRegistrations = state.agentAuthRegistrations;
    this.agentAuthJtis = state.agentAuthJtis;
    this.agentAuthAccessTokens = state.agentAuthAccessTokens;
    this.apiKeys = state.apiKeys;
    this.artifacts = state.artifacts;
    this.revisions = state.revisions;
    this.artifactFiles = state.artifactFiles;
    this.uploadSessions = state.uploadSessions;
    this.uploadSessionFiles = state.uploadSessionFiles;
    this.operationEvents = state.operationEvents;
    this.platformLockdowns = state.platformLockdowns;
    this.accessLinks = state.accessLinks;
    this.safetyWarnings = state.safetyWarnings;
    this.claimTokens = state.claimTokens;
    this.contentBlobs = state.contentBlobs;
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
