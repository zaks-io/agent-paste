import type {
  CommitSpec,
  PathExpectation,
  UploadDeletion,
  UploadPrefixDeletion,
  UploadSessionChunks,
} from "@agent-paste/contracts";

// ADR 0089: a unified-diff descriptor for a single changed file. The uploaded
// bytes are the diff; jobs reconstructs the whole result blob in Stage 4.
export type UploadSessionFilePatchInput = {
  base_sha256: string;
  format: "unified";
  result_sha256: string;
};

export type CreateUploadSessionRequest = {
  artifact_id?: string;
  // Base Revision to inherit unchanged files from (ADR 0089 tree inheritance).
  base_revision_id?: string;
  title?: string;
  entrypoint?: string;
  // Paths present in the base Revision that this publish drops (base-only).
  deleted_paths?: string[];
  commit?: CommitSpec;
  deletions?: UploadDeletion[] | undefined;
  prefix_deletions?: UploadPrefixDeletion[] | undefined;
  more_files?: boolean;
  files: Array<{
    path: string;
    size_bytes: number;
    sha256?: string | undefined;
    patch?: UploadSessionFilePatchInput | undefined;
    chunks?: UploadSessionChunks | undefined;
    expect?: PathExpectation | undefined;
  }>;
};

export type ObservedUploadFile = { path: string; objectKey: string; sizeBytes: number };
