import type { AgentView } from "@agent-paste/contracts/agent-view";
import type { ArtifactFileListResponse } from "@agent-paste/contracts/artifact-files";
import type {
  ArtifactId,
  ArtifactReference,
  FilePath,
  IdempotencyKey,
  PlainTextTitle,
  RevisionId,
  Sha256Hex,
  UploadSessionId,
} from "@agent-paste/contracts/primitives";
import type { PublishRevisionRequest } from "@agent-paste/contracts/revisions";
import type {
  AppendUploadFilesRequest,
  AppendUploadFilesResponse,
  CommitSpec,
  CompleteUploadFilesRequest,
  CompleteUploadFilesResponse,
  CreateUploadSessionRequest,
  CreateUploadSessionResponse,
  FinalizeUploadSessionResponse,
  PathExpectation,
  PublishRevisionResponse,
  UploadSessionTargetsResponse,
} from "@agent-paste/contracts/upload-sessions";

export type PublishFilePatch = { baseSha256: Sha256Hex; resultSha256: Sha256Hex };
export type PublishFile = {
  path: string;
  sizeBytes: number;
  sha256: Sha256Hex;
  contentType: string;
  read: () => Promise<Uint8Array> | Uint8Array;
  patch?: PublishFilePatch;
  expect?: PathExpectation;
};
export type LocalSource = Omit<PublishFile, "read"> & {
  chunkSha256?: Sha256Hex[];
  readRange(start: number, length: number): Promise<Uint8Array>;
};
export type PublishInput = {
  files: PublishFile[];
  title: PlainTextTitle;
  entrypoint: string;
  artifactId?: ArtifactReference;
  baseRevisionId?: RevisionId;
  deletedPaths?: FilePath[];
  idempotencyKey: IdempotencyKey;
  commit?: CommitSpec;
  pin?: boolean;
  onUploadProgress?: (progress: { uploadedFiles: number; totalToUpload: number; uploadedBytes: number }) => void;
};
export type UploadStats = {
  totalFiles: number;
  totalBytes: number;
  uploadedFiles: number;
  uploadedBytes: number;
  reusedFiles: number;
  reusedBytes: number;
};
export type PublishOutcome = {
  url: string;
  title: string;
  expiresAt: string;
  uploadStats: UploadStats;
  result: PublishRevisionResponse;
  noChange?: boolean;
};
export type PublishTransport = {
  createUploadSession(body: CreateUploadSessionRequest, key: IdempotencyKey): Promise<CreateUploadSessionResponse>;
  putFile(putUrl: string, bytes: Uint8Array, headers: Record<string, string>): Promise<void>;
  finalize(id: UploadSessionId, key: IdempotencyKey): Promise<FinalizeUploadSessionResponse>;
  publishRevision(
    artifactId: ArtifactId,
    revisionId: RevisionId,
    key: IdempotencyKey,
    body?: PublishRevisionRequest,
  ): Promise<PublishRevisionResponse>;
  // Optional only for small explicit-edit adapters that already carry their guards.
  listFiles?: (
    artifactId: string,
    query?: { revision_id?: string; prefix?: string; cursor?: string; limit?: number },
  ) => Promise<ArtifactFileListResponse>;
  getAgentView?: (artifactId: string, revisionId?: string) => Promise<AgentView>;
  appendFiles?: (
    id: UploadSessionId,
    body: AppendUploadFilesRequest,
    key: IdempotencyKey,
  ) => Promise<AppendUploadFilesResponse>;
  targets?: (id: UploadSessionId, query?: { cursor?: string; limit?: number }) => Promise<UploadSessionTargetsResponse>;
  completeFiles?: (
    id: UploadSessionId,
    body: CompleteUploadFilesRequest,
    key: IdempotencyKey,
  ) => Promise<CompleteUploadFilesResponse>;
};
