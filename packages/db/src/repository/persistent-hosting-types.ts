import type { ArtifactFileListItem, StorageUsage, UploadSessionTargetsResponse } from "@agent-paste/contracts";
import type { RevisionFileMapV1 } from "@agent-paste/storage";

export type FileMapStore = {
  write(map: RevisionFileMapV1): Promise<{ sha256: string; size_bytes: number; r2_key: string }>;
};
export type UploadTarget =
  | { status: "upload_required"; path: string; object_key: string; size_bytes: number; sha256: string | null }
  | {
      status: "chunk_upload_required";
      path: string;
      chunk_index: number;
      object_key: string;
      size_bytes: number;
      sha256: string;
    }
  | { status: "verify_required"; path: string };
export type UploadTargetsPage = {
  upload_session_id: string;
  workspace_id: string;
  artifact_id: string;
  revision_id: string;
  status: UploadSessionTargetsResponse["status"];
  sealed: boolean;
  expires_at: string;
  remaining: UploadSessionTargetsResponse["remaining"];
  targets: UploadTarget[];
  page_info: { next_cursor: string | null; has_more: boolean };
};
export type ChunkedFileForCompletion = {
  sizeBytes: number;
  sha256: string;
  chunks: Array<{ sha256: string; sizeBytes: number; uploaded: boolean }>;
  verifiedAt: string | null;
};
export type RetentionView = {
  artifact_id: string;
  workspace_id: string;
  capability_id: string;
  retention: "pinned" | "temporary";
  pinned_at: string | null;
  expires_at: string;
  effective_expires_at: string | null;
  updated_at: string;
  pinned_count: number;
  pin_allowance: number;
};
export type ArtifactFileListPage = {
  artifact_id: string;
  revision_id: string;
  file_count: number;
  size_bytes: number;
  entrypoint: string;
  title: string;
  items: Array<Omit<ArtifactFileListItem, "path"> & { path: string }>;
  page_info: { next_cursor: string | null; has_more: boolean };
};
export type RevisionReadTarget = {
  artifactId: string;
  revisionId: string;
  workspaceId: string;
  fileMap: { sha256: string; size_bytes: number } | null;
  objectKeys: Record<string, string> | null;
  fileCount: number;
  sizeBytes: number;
  ephemeralTier: boolean;
};
export type RetentionOperation = "artifact.pin" | "artifact.unpin" | "web.artifact.pin" | "web.artifact.unpin";
export type { StorageUsage };
