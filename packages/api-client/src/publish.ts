import type {
  ArtifactId,
  CreateUploadSessionRequest,
  CreateUploadSessionResponse,
  FilePath,
  FinalizeUploadSessionResponse,
  IdempotencyKey,
  PlainTextTitle,
  PublishResult,
  PublishRevisionRequest,
  RenderMode,
  RevisionId,
  Sha256Hex,
  UploadSessionFileInput,
  UploadSessionId,
} from "@agent-paste/contracts";

/** A unified-diff patch a changed file is sent as instead of whole bytes (ADR 0090). */
export type PublishFilePatch = {
  baseSha256: Sha256Hex;
  resultSha256: Sha256Hex;
};

/**
 * One file to publish, with its bytes available on demand. The caller computes
 * the digest (CLI from disk, MCP from the in-memory body); `read` is only
 * invoked for targets the server reports as `upload_required`.
 *
 * When `patch` is set, `read` returns the unified-diff bytes (not the whole file)
 * and `sizeBytes`/`sha256` describe that diff; the server reconstructs and
 * re-hashes the whole file to `patch.resultSha256` at finalize.
 */
export type PublishFile = {
  path: string;
  sizeBytes: number;
  sha256: Sha256Hex;
  contentType: string;
  read: () => Promise<Uint8Array> | Uint8Array;
  patch?: PublishFilePatch;
};

export type PublishInput = {
  files: PublishFile[];
  title: PlainTextTitle;
  entrypoint: string;
  /** Omitted => server infers from the entrypoint extension. */
  renderMode?: RenderMode;
  /** Present => publish a new Revision on an existing Artifact. */
  artifactId?: ArtifactId;
  /**
   * Present => a partial-manifest publish: `files` lists only changed/added paths
   * (some possibly as patches), `deletedPaths` drops paths, and every other path
   * inherits from this base Revision by reference (ADR 0090).
   */
  baseRevisionId?: RevisionId;
  deletedPaths?: FilePath[];
  /** Opaque, caller-supplied (CLI nonce, MCP deterministic). The module never derives its own. */
  idempotencyKey: IdempotencyKey;
  /** Optional per-file upload progress (CLI rich-mode spinner). Called after each upload. */
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
  /** The private viewer link to hand back: a login-walled clean viewer (`/v/<id>`). */
  privateUrl?: string | undefined;
  title: string;
  expiresAt: string;
  uploadStats: UploadStats;
  /** The full server payload, for surfaces that need ids / content URLs. */
  result: PublishResult;
};

/**
 * The single seam between the shared publish sequence and the two transports.
 * CLI implements this over its HTTP `ApiClient`; MCP implements it over Worker
 * service bindings. All error mapping lives in the adapter — `runPublish`
 * interprets nothing.
 *
 * `putFile` uploads file bytes to the signed `put_url` the upload session
 * returns, sending the session's `required_headers` (e.g. the signed
 * content-length) merged with the content type. It carries no bearer token —
 * the URL itself is the credential.
 */
export type PublishTransport = {
  createUploadSession(body: CreateUploadSessionRequest, key: IdempotencyKey): Promise<CreateUploadSessionResponse>;
  putFile(putUrl: string, bytes: Uint8Array, headers: Record<string, string>): Promise<void>;
  finalize(uploadSessionId: UploadSessionId, key: IdempotencyKey): Promise<FinalizeUploadSessionResponse>;
  publishRevision(
    artifactId: ArtifactId,
    revisionId: RevisionId,
    key: IdempotencyKey,
    body?: PublishRevisionRequest,
  ): Promise<PublishResult>;
};

/**
 * The one publish path shared by the CLI and the MCP server: create an upload
 * session, upload the files the server does not already have, finalize, and
 * publish the revision. Authenticated publish returns `private_url`; ephemeral
 * publish returns `unlisted_url`.
 */
export async function runPublish(transport: PublishTransport, input: PublishInput): Promise<PublishOutcome> {
  const session = await transport.createUploadSession(buildCreateSessionRequest(input), input.idempotencyKey);

  const filesByPath = new Map(input.files.map((file) => [file.path, file]));
  const stats: UploadStats = {
    totalFiles: session.files.length,
    totalBytes: input.files.reduce((sum, file) => sum + file.sizeBytes, 0),
    uploadedFiles: 0,
    uploadedBytes: 0,
    reusedFiles: 0,
    reusedBytes: 0,
  };

  const totalToUpload = session.files.filter((target) => target.status !== "reused").length;
  for (const target of session.files) {
    const file = filesByPath.get(target.path);
    if (!file) {
      throw new Error(`Upload session returned an unknown file: ${target.path}`);
    }
    if (target.status === "reused") {
      stats.reusedFiles += 1;
      stats.reusedBytes += file.sizeBytes;
      continue;
    }
    await transport.putFile(target.put_url, await asBytes(file.read()), {
      "content-type": file.contentType,
      ...target.required_headers,
    });
    stats.uploadedFiles += 1;
    stats.uploadedBytes += file.sizeBytes;
    input.onUploadProgress?.({ uploadedFiles: stats.uploadedFiles, totalToUpload, uploadedBytes: stats.uploadedBytes });
  }

  const finalized = await transport.finalize(session.upload_session_id, input.idempotencyKey);
  const result = await transport.publishRevision(finalized.artifact_id, finalized.revision_id, input.idempotencyKey);

  return {
    ...("private_url" in result ? { privateUrl: result.private_url } : {}),
    title: result.title,
    expiresAt: result.expires_at,
    uploadStats: stats,
    result,
  };
}

function buildCreateSessionRequest(input: PublishInput): CreateUploadSessionRequest {
  return {
    ...(input.artifactId ? { artifact_id: input.artifactId } : {}),
    ...(input.baseRevisionId ? { base_revision_id: input.baseRevisionId } : {}),
    title: input.title,
    entrypoint: input.entrypoint,
    ...(input.renderMode ? { render_mode: input.renderMode } : {}),
    ...(input.deletedPaths && input.deletedPaths.length > 0 ? { deleted_paths: input.deletedPaths } : {}),
    // A patched entry omits sha256 (the contract forbids both) and carries the
    // diff descriptor; the uploaded bytes are the diff and size_bytes is its size.
    files: input.files.map((file) => buildFileEntry(file)),
  } as CreateUploadSessionRequest;
}

function buildFileEntry(file: PublishFile): UploadSessionFileInput {
  const entry = file.patch
    ? {
        path: file.path,
        size_bytes: file.sizeBytes,
        patch: { base_sha256: file.patch.baseSha256, format: "unified", result_sha256: file.patch.resultSha256 },
      }
    : { path: file.path, size_bytes: file.sizeBytes, sha256: file.sha256 };
  // path/sha256 are branded contract types; the runtime values are plain strings
  // the server validates. The brand is erased at the wire boundary.
  return entry as unknown as UploadSessionFileInput;
}

async function asBytes(value: Promise<Uint8Array> | Uint8Array): Promise<Uint8Array> {
  return value instanceof Uint8Array ? value : await value;
}
