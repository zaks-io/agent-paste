import type { AppendUploadFilesRequest, CompleteUploadFilesResponse } from "@agent-paste/contracts";
import type { ApiActor } from "../types.js";
import type { UploadSessionRecord } from "../upload-session-lifecycle.js";
import type {
  ArtifactFileListPage,
  ChunkedFileForCompletion,
  RetentionOperation,
  RetentionView,
  RevisionReadTarget,
  StorageUsage,
  UploadTargetsPage,
} from "./persistent-hosting-types.js";

export type PersistentHostingRepository = {
  ensureRevisionFileMap(input: {
    workspaceId: string;
    revisionId: string;
  }): Promise<"present" | "written" | "not_live">;
  appendUploadFiles(input: {
    actor: ApiActor;
    idempotencyKey: string;
    sessionId: string;
    request: AppendUploadFilesRequest;
    now: string;
  }): Promise<UploadSessionRecord>;
  listUploadTargets(input: {
    actor: ApiActor;
    sessionId: string;
    cursor?: string;
    limit: number;
    now: string;
  }): Promise<UploadTargetsPage>;
  recordUploadedChunk(input: {
    workspaceId: string;
    sessionId: string;
    path: string;
    chunkIndex: number;
    r2CleanupEligible?: boolean;
    sha256: string;
    sizeBytes: number;
    objectKey: string;
    uploadedAt: string;
  }): Promise<void>;
  getChunkedFileForCompletion(input: {
    actor: ApiActor;
    sessionId: string;
    path: string;
  }): Promise<ChunkedFileForCompletion | null>;
  recordChunkedFileVerified(input: { actor: ApiActor; sessionId: string; path: string; now: string }): Promise<void>;
  completeUploadFiles(input: {
    actor: ApiActor;
    idempotencyKey: string;
    sessionId: string;
    paths: string[];
    now: string;
  }): Promise<CompleteUploadFilesResponse>;
  setArtifactRetention(input: {
    actor: ApiActor;
    idempotencyKey: string;
    artifactId: string;
    pinned: boolean;
    operation: RetentionOperation;
    now: string;
  }): Promise<RetentionView>;
  listArtifactFiles(input: {
    actor: ApiActor;
    artifactId: string;
    revisionId?: string;
    prefix?: string;
    cursor?: string;
    limit: number;
  }): Promise<ArtifactFileListPage | null>;
  getRevisionReadTarget(input: {
    actor: ApiActor;
    artifactId: string;
    revisionId?: string;
  }): Promise<RevisionReadTarget | null>;
  getStorageUsage(input: { actor: ApiActor; now: string }): Promise<StorageUsage>;
};
