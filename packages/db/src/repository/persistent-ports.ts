import type {
  ContentBlobChunk,
  StoredFile,
  UploadSession,
  UploadSessionChunk,
  UploadSessionDeletion,
} from "../types.js";

export type StorageBreakdown = {
  blob_bytes: number;
  legacy_file_bytes: number;
  bundle_bytes: number;
  file_entry_bytes: number;
};
export type PersistentEntities = {
  lockLiveContentBlob(workspaceId: string, sha256: string, sizeBytes: number): Promise<boolean>;
  lockWorkspace(id: string): Promise<void>;
  lockArtifact(id: string, workspaceId: string): Promise<void>;
  updateSession(session: UploadSession): Promise<void>;
  updateFile(sessionId: string, file: StoredFile): Promise<void>;
  insertChunks(chunks: UploadSessionChunk[]): Promise<void>;
  listChunks(sessionId: string, path?: string): Promise<UploadSessionChunk[]>;
  markChunkUploaded(sessionId: string, path: string, index: number, now: string): Promise<void>;
  insertDeletions(deletions: UploadSessionDeletion[]): Promise<void>;
  listDeletions(sessionId: string): Promise<UploadSessionDeletion[]>;
  insertBlobChunks(chunks: ContentBlobChunk[]): Promise<void>;
  listBlobChunks(workspaceId: string, sha256: string, size: number): Promise<ContentBlobChunk[]>;
  setFileMap(revisionId: string, sha256: string, size: number): Promise<void>;
  storageUsage(workspaceId: string, now: string): Promise<{ breakdown: StorageBreakdown; reserved_bytes: number }>;
};
